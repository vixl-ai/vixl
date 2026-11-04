import { effectScope, ref, watch } from 'vue'
import type { FleetProject } from '@/types/fleet/fleet-project'
import type { ChatMeta } from '@/types/chat/chat-meta'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import { revealedProjectSlug } from '@/composables/fleet-project-reveal'

const HOME_ORDER_KEY = 'home'
const EMPTY_PROJECT_UPDATED_AT = '1970-01-01T00:00:00.000Z'

const stableOrder = ref<string[]>([])

type FleetOrderSource = {
  projects: { value: FleetProject[] }
  groups?: { value: Array<{ slug: string }> }
}

type ChatsBySlug = { value: Record<string, ChatMeta[]> }

type ProjectOrderItem = { kind: 'project'; project: { slug: string } }
type HomeOrderItem = { kind: 'home' }

let slugWatchStarted = false
let chatsBySlug: ChatsBySlug | null = null
let readFleet: (() => {
  projects: FleetProject[]
  groups: Array<{ slug: string }>
}) | null = null

const projectOrderKey = (slug: string): string => `project:${slug}`

const nestedProjectIds = (projects: FleetProject[]): Set<string> => {
  const byId = new Map(projects.map((project) => [project.id, project]))
  const nestedIds = new Set<string>()
  for (const project of projects) {
    const parentId = project.worktree?.parentId
    if (!parentId || !byId.has(parentId)) {
      continue
    }
    nestedIds.add(project.id)
  }
  return nestedIds
}

const topLevelSlugSetKey = (
  projects: FleetProject[],
  groups: Array<{ slug: string }>,
): string => {
  const nestedIds = nestedProjectIds(projects)
  const slugs: string[] = []
  for (const project of projects) {
    if (!nestedIds.has(project.id)) {
      slugs.push(`project:${project.slug}`)
    }
  }
  for (const group of groups) {
    slugs.push(`group:${group.slug}`)
  }
  slugs.sort()
  return slugs.join('\0')
}

export const latestChatUpdatedAt = (chats: ChatMeta[]): string => {
  if (chats.length === 0) {
    return ''
  }
  return chats.reduce(
    (latest, chat) => (chat.updatedAt > latest ? chat.updatedAt : latest),
    chats[0]!.updatedAt,
  )
}

export const projectActivityUpdatedAt = (chats: ChatMeta[]): string =>
  latestChatUpdatedAt(chats) || EMPTY_PROJECT_UPDATED_AT

export const recomputeFleetSidebarOrder = (): void => {
  if (!readFleet || !chatsBySlug) {
    return
  }
  const { projects, groups } = readFleet()
  const nestedIds = nestedProjectIds(projects)
  const entries: Array<{ key: string; updatedAt: string; revealed: boolean }> = []
  for (const project of projects) {
    if (nestedIds.has(project.id)) {
      continue
    }
    const chats = chatsBySlug.value[project.slug] ?? []
    entries.push({
      key: projectOrderKey(project.slug),
      updatedAt: projectActivityUpdatedAt(chats),
      revealed: project.slug === revealedProjectSlug.value,
    })
  }
  for (const group of groups) {
    const chats = chatsBySlug.value[group.slug] ?? []
    entries.push({
      key: projectOrderKey(group.slug),
      updatedAt: projectActivityUpdatedAt(chats),
      revealed: group.slug === revealedProjectSlug.value,
    })
  }
  const homeChats = chatsBySlug.value[HOME_CHAT_SLUG] ?? []
  if (homeChats.length > 0) {
    entries.push({
      key: HOME_ORDER_KEY,
      updatedAt: latestChatUpdatedAt(homeChats),
      revealed: false,
    })
  }
  entries.sort((left, right) => {
    if (left.revealed !== right.revealed) {
      return left.revealed ? -1 : 1
    }
    return right.updatedAt.localeCompare(left.updatedAt)
  })
  stableOrder.value = entries.map((entry) => entry.key)
}

export const bindFleetSidebarOrder = (
  chats: ChatsBySlug,
  fleet: FleetOrderSource,
): void => {
  chatsBySlug = chats
  if (slugWatchStarted) {
    return
  }
  slugWatchStarted = true
  readFleet = () => ({
    projects: fleet.projects.value,
    groups: fleet.groups?.value ?? [],
  })
  effectScope(true).run(() => {
    watch(
      () => topLevelSlugSetKey(fleet.projects.value, fleet.groups?.value ?? []),
      () => {
        recomputeFleetSidebarOrder()
      },
      { flush: 'sync' },
    )
  })
}

export const orderedActivityItems = <T extends ProjectOrderItem | HomeOrderItem>(
  items: T[],
): T[] => {
  const byKey = new Map<string, T>()
  for (const item of items) {
    const key = item.kind === 'home' ? HOME_ORDER_KEY : projectOrderKey(item.project.slug)
    byKey.set(key, item)
  }
  const ordered: T[] = []
  const seen = new Set<string>()
  for (const key of stableOrder.value) {
    const item = byKey.get(key)
    if (!item || seen.has(key)) {
      continue
    }
    ordered.push(item)
    seen.add(key)
  }
  for (const [key, item] of byKey) {
    if (seen.has(key)) {
      continue
    }
    ordered.push(item)
  }
  return ordered
}
