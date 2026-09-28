import { computed, nextTick, ref, type ComponentPublicInstance } from 'vue'
import useFleetSidebar, {
  type FleetSidebarActivityItem,
} from '@/composables/use-fleet-sidebar'
import type { FleetSidebarChat } from '@/types/fleet/fleet-sidebar-chat'
import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'

const searchOpen = ref(false)
const searchQuery = ref('')
const runningOnly = ref(false)
const searchInputEl = ref<HTMLInputElement | ComponentPublicInstance | null>(null)

const focusSearchInput = (): void => {
  const target = searchInputEl.value
  if (target instanceof HTMLInputElement) {
    target.focus()
    return
  }
  if (target && '$el' in target && target.$el instanceof HTMLInputElement) {
    target.$el.focus()
  }
}

const filterChats = (
  chats: FleetSidebarChat[],
  name: string,
  query: string,
  runningOnlyValue: boolean,
): FleetSidebarChat[] | null => {
  let next = chats

  if (runningOnlyValue) {
    next = next.filter((chat) => chat.status === 'running')
  }

  if (query) {
    const nameMatches = name.toLowerCase().includes(query)
    const matchingChats = next.filter((chat) =>
      chat.title.toLowerCase().includes(query),
    )

    if (!nameMatches && matchingChats.length === 0) {
      return null
    }

    next = nameMatches ? next : matchingChats
  }

  return next
}

const filterProject = (
  project: FleetSidebarProject,
  query: string,
  runningOnlyValue: boolean,
): FleetSidebarProject | null => {
  const chats = filterChats(
    project.chats,
    project.displayName,
    query,
    runningOnlyValue,
  )
  if (chats === null) {
    return null
  }

  return {
    ...project,
    chats,
  }
}

export default () => {
  const fleetSidebar = useFleetSidebar()

  const filteredProjects = computed<FleetSidebarProject[]>(() => {
    const query = searchQuery.value.trim().toLowerCase()

    return fleetSidebar.sidebarProjects.value
      .map((project) => filterProject(project, query, runningOnly.value))
      .filter((project): project is FleetSidebarProject => project !== null)
  })

  const filteredActivityItems = computed<FleetSidebarActivityItem[]>(() => {
    const query = searchQuery.value.trim().toLowerCase()
    const next: FleetSidebarActivityItem[] = []

    for (const item of fleetSidebar.activityItems.value) {
      if (item.kind === 'project') {
        const filtered = filterProject(item.project, query, runningOnly.value)
        if (filtered) {
          next.push({ ...item, project: filtered })
        }
        continue
      }

      const chats = filterChats(item.chats, 'home', query, runningOnly.value)
      if (chats && chats.length > 0) {
        next.push({ ...item, chats })
      }
    }

    return next
  })

  const toggleRunningFilter = (): void => {
    runningOnly.value = !runningOnly.value
  }

  const openSearch = async (): Promise<void> => {
    searchOpen.value = true
    await nextTick()
    focusSearchInput()
  }

  const closeSearch = (): void => {
    searchOpen.value = false
    searchQuery.value = ''
  }

  return {
    searchOpen,
    searchQuery,
    runningOnly,
    searchInputEl,
    filteredProjects,
    filteredActivityItems,
    toggleRunningFilter,
    openSearch,
    closeSearch,
  }
}
