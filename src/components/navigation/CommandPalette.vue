<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/shadcn/ui/command'
import { Tabs, TabsList, TabsTrigger } from '@/components/shadcn/ui/tabs'
import useCommandPalette from '@/composables/use-command-palette'
import {
  COMMAND_PALETTE_GROUP_ORDER,
  COMMAND_PALETTE_TABS,
  getCommandPaletteTab,
  type CommandPaletteItem,
  type CommandPaletteTab,
} from '@/types/navigation/command-palette-item'
import useFleetRegistry from '@/composables/use-fleet-registry'
import chatRouteFor from '@/utils/chat-route-for'
import projectRouteFor from '@/utils/project-route-for'
import useWorkbenchStore from '@/composables/use-workbench-store'

const router = useRouter()
const fleet = useFleetRegistry()
const workbench = useWorkbenchStore()
const { open, items, closePalette } = useCommandPalette()

const activeTab = ref<CommandPaletteTab>('All')

const filteredItems = computed(() => {
  if (activeTab.value === 'All') {
    return items.value
  }

  return items.value.filter((item) => getCommandPaletteTab(item) === activeTab.value)
})

const groupedItems = computed(() =>
  COMMAND_PALETTE_GROUP_ORDER.map((group) => ({
    group,
    items: filteredItems.value.filter((item) => item.group === group),
  })).filter((section) => section.items.length > 0),
)

const itemIcon = (item: CommandPaletteItem) => {
  if (item.action === 'new-agent') {
    return 'bot'
  }
  if (item.action === 'open-settings' || item.settingsSection) {
    return 'settings'
  }
  if (item.action === 'open-terminal') {
    return 'terminal'
  }
  if (item.action === 'open-editor') {
    return 'file-code'
  }
  if (item.group === 'Projects') {
    return 'folder'
  }
  if (item.group === 'Pinned') {
    return 'pin'
  }
  return 'message-square'
}

const handleSelect = async (item: CommandPaletteItem): Promise<void> => {
  closePalette()

  try {
    if (item.action === 'new-agent') {
      await router.push('/')
      return
    }

    if (item.action === 'open-settings') {
      await router.push('/settings')
      return
    }

    if (item.action === 'open-terminal') {
      try {
        await workbench.openTerminal(workbench.resolveWorkspaceProjectId())
      } catch (error) {
        toast.error('Could not open terminal', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
      return
    }

    if (item.action === 'open-editor') {
      try {
        const projectId = workbench.resolveWorkspaceProjectId()
        await workbench.openEditor(projectId, fleet.activeProjectId.value ? 'README.md' : '')
      } catch (error) {
        toast.error('Could not open editor', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
      return
    }

    if (item.settingsSection) {
      await router.push({
        path: '/settings',
        query: { section: item.settingsSection },
      })
      return
    }

    if (item.chatId && item.projectSlug) {
      await router.push(chatRouteFor(item.projectSlug, item.chatId))
      return
    }

    if (item.projectSlug) {
      const project = fleet.projects.value.find((entry) => entry.slug === item.projectSlug)
      if (!project) {
        toast.error('Project not found')
        return
      }
      await router.push(projectRouteFor(project.slug))
    }
  } catch (error) {
    toast.error('Action failed', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <CommandDialog v-model:open="open">
    <CommandInput placeholder="Search projects, chats, and actions…" />
    <Tabs
      :model-value="activeTab"
      class="px-2 pt-2 pb-1"
      @update:model-value="
        (value) => {
          activeTab = value as CommandPaletteTab
        }
      "
    >
      <TabsList class="grid w-full grid-cols-4">
        <TabsTrigger v-for="tab in COMMAND_PALETTE_TABS" :key="tab" :value="tab">
          {{ tab }}
        </TabsTrigger>
      </TabsList>
    </Tabs>
    <CommandList>
      <CommandEmpty>No results found.</CommandEmpty>
      <template v-if="activeTab === 'All'">
        <CommandGroup v-for="section in groupedItems" :key="section.group" :heading="section.group">
          <CommandItem
            v-for="item in section.items"
            :key="item.id"
            :value="item.subtitle ? `${item.label} ${item.subtitle}` : item.label"
            @select="handleSelect(item)"
          >
            <component :is="itemIcon(item)" />
            <span class="truncate">{{ item.label }}</span>
            <span v-if="item.subtitle" class="ml-auto truncate text-xs text-muted-foreground">
              {{ item.subtitle }}
            </span>
          </CommandItem>
        </CommandGroup>
      </template>
      <CommandGroup v-else>
        <CommandItem
          v-for="item in filteredItems"
          :key="item.id"
          :value="item.subtitle ? `${item.label} ${item.subtitle}` : item.label"
          @select="handleSelect(item)"
        >
          <component :is="itemIcon(item)" />
          <span class="truncate">{{ item.label }}</span>
          <span v-if="item.subtitle" class="ml-auto truncate text-xs text-muted-foreground">
            {{ item.subtitle }}
          </span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
