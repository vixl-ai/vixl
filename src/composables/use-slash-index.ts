import { ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { vixlFileChangeToken } from '@/composables/use-vixl-live-sync'
import { isDisconnectedRoot } from '@/composables/ssh-session/fleet'
import { listAgentIndex } from '@/services/agents/registry'
import {
  looksLikeSessionDropped,
  looksLikeUnreachable,
} from '@/services/harness/ssh/map-error'
import isReservedSlashName from '@/services/skills/is-reserved-slash-name'
import { listSlashSkillIndex } from '@/services/skills/skill-registry'
import formatUnknownError from '@/utils/format-unknown-error'
import { isSshProjectRoot } from '@/utils/ssh-project-root'
import type { SlashIndexEntry } from '@/types/chat/slash-index-entry'

const RECONNECT_HINT = 'Right click the project and click reconnect'

const announcedOfflineRoots = new Set<string>()

export const resetSlashIndexToastsForTests = (): void => {
  announcedOfflineRoots.clear()
}

const offlineSshLoadError = (root: string | null, error: unknown): boolean => {
  if (!root || !isSshProjectRoot(root)) {
    return false
  }
  const message = formatUnknownError(error)
  return looksLikeUnreachable(message) || looksLikeSessionDropped(message)
}

const toastLoadFailure = (
  title: string,
  error: unknown,
  root: string | null,
): boolean => {
  if (!offlineSshLoadError(root, error)) {
    toast.error(title, {
      description: formatUnknownError(error),
    })
    return false
  }
  if (!root || isDisconnectedRoot(root) || announcedOfflineRoots.has(root)) {
    return true
  }
  announcedOfflineRoots.add(root)
  toast.error(title, {
    id: `slash-offline:${root}`,
    description: RECONNECT_HINT,
  })
  return true
}

export default (projectRoot: () => string | null) => {
  const entries = ref<SlashIndexEntry[]>([])

  const refresh = async (): Promise<void> => {
    const root = projectRoot()
    let skills: SlashIndexEntry[] = []
    let agents: SlashIndexEntry[] = []
    let offline = false
    try {
      skills = (await listSlashSkillIndex(root)).map((skill) => ({
        kind: 'skill' as const,
        name: skill.name,
        description: skill.description,
        scope: skill.scope,
      }))
    } catch (error) {
      offline = toastLoadFailure('Failed to load skills', error, root) || offline
    }
    try {
      agents = (await listAgentIndex(root))
        .filter(
          (agent) =>
            !isReservedSlashName(agent.name) && !isReservedSlashName(agent.id),
        )
        .map((agent) => ({
          kind: 'agent' as const,
          name: agent.name,
          description: agent.description,
          scope: agent.scope,
        }))
    } catch (error) {
      offline = toastLoadFailure('Failed to load agents', error, root) || offline
    }
    if (root && !offline) {
      announcedOfflineRoots.delete(root)
    }
    entries.value = [...skills, ...agents]
  }

  watch(
    [projectRoot, vixlFileChangeToken],
    () => {
      refresh().catch((error) => {
        toastLoadFailure('Failed to load slash commands', error, projectRoot())
      })
    },
    { immediate: true },
  )

  const filterEntries = (query: string): SlashIndexEntry[] => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return entries.value
    }
    return entries.value.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.description.toLowerCase().includes(needle),
    )
  }

  return {
    entries,
    filterEntries,
    refresh,
  }
}
