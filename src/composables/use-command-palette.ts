import { computed, ref } from 'vue'
import useFleetSidebar from '@/composables/use-fleet-sidebar'
import {
  PERSONAL_SECTIONS,
  SECTION_LABELS,
} from '@/types/settings/settings-section'
import type { CommandPaletteItem } from '@/types/navigation/command-palette-item'
import { flattenSidebarProjects } from '@/utils/find-sidebar-project'

const open = ref(false)

export default () => {
  const { sidebarProjects, pinnedChats } = useFleetSidebar()

  const items = computed<CommandPaletteItem[]>(() => {
    const result: CommandPaletteItem[] = [
      {
        id: 'action-new-agent',
        group: 'Actions',
        label: 'New Agent',
        action: 'new-agent',
      },
      {
        id: 'action-open-settings',
        group: 'Actions',
        label: 'Open Settings',
        action: 'open-settings',
      },
      {
        id: 'action-open-terminal',
        group: 'Actions',
        label: 'Open Terminal',
        action: 'open-terminal',
      },
      {
        id: 'action-open-editor',
        group: 'Actions',
        label: 'Open Editor',
        action: 'open-editor',
      },
    ]

    for (const project of flattenSidebarProjects(sidebarProjects.value)) {
      result.push({
        id: `project-${project.slug}`,
        group: 'Projects',
        label: project.displayName,
        projectSlug: project.slug,
      })

      for (const chat of project.chats) {
        result.push({
          id: `chat-${project.slug}-${chat.id}`,
          group: 'Chats',
          label: chat.title,
          subtitle: project.displayName,
          projectSlug: project.slug,
          chatId: chat.id,
        })
      }
    }

    for (const chat of pinnedChats.value) {
      result.push({
        id: `pinned-${chat.chatId}`,
        group: 'Pinned',
        label: chat.title,
        subtitle: chat.projectLabel,
        projectSlug: chat.projectSlug,
        chatId: chat.chatId,
      })
    }

    for (const section of PERSONAL_SECTIONS) {
      result.push({
        id: `settings-${section}`,
        group: 'Settings',
        label: SECTION_LABELS[section],
        settingsSection: section,
      })
    }

    return result
  })

  const openPalette = (): void => {
    open.value = true
  }

  const closePalette = (): void => {
    open.value = false
  }

  const togglePalette = (): void => {
    open.value = !open.value
  }

  return {
    open,
    items,
    openPalette,
    closePalette,
    togglePalette,
  }
}
