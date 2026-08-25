<script setup lang="ts">
import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import {
  FileCode,
  GitBranch,
  Terminal,
} from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useWorkbenchStore from '@/composables/use-workbench-store'

const props = withDefaults(
  defineProps<{
    triggerClass?: string
    tooltip?: string
  }>(),
  {
    tooltip: 'New tab',
  },
)

const fleet = useFleetRegistry()
const workbench = useWorkbenchStore()
const open = ref(false)

const items = [
  { id: 'editor', label: 'Editor', icon: FileCode, requiresProject: false },
  { id: 'terminal', label: 'Terminal', icon: Terminal, requiresProject: false },
  { id: 'changes', label: 'Changes', icon: GitBranch, requiresProject: true },
] as const

const activeProjectId = computed(() => fleet.activeProjectId.value)

const isItemDisabled = (item: (typeof items)[number]): boolean =>
  item.requiresProject && !activeProjectId.value

const handleOpen = async (type: (typeof items)[number]['id']): Promise<void> => {
  const projectId = workbench.resolveWorkspaceProjectId()

  try {
    switch (type) {
      case 'editor':
        await workbench.openEditor(
          projectId,
          activeProjectId.value ? 'README.md' : '',
        )
        break
      case 'terminal':
        await workbench.openTerminal(projectId)
        break
      case 'changes':
        if (!activeProjectId.value) {
          toast.error('Select a project', {
            description: 'Changes requires a project with a git repository.',
          })
          return
        }
        await workbench.openChanges(projectId)
        break
    }
    open.value = false
  } catch (error) {
    toast.error('Could not open tab', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <Tooltip :disable-closing-trigger="true">
    <TooltipTrigger as-child>
      <span class="inline-flex shrink-0">
        <DropdownMenu v-model:open="open">
          <DropdownMenuTrigger as-child>
            <slot>
              <Button
                variant="ghost"
                size="icon"
                :class="props.triggerClass"
                :aria-label="props.tooltip"
              >
                <span class="text-lg leading-none">+</span>
              </Button>
            </slot>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="z-[60] w-40">
            <DropdownMenuItem
              v-for="item in items"
              :key="item.id"
              :disabled="isItemDisabled(item)"
              @click="handleOpen(item.id)"
            >
              <component :is="item.icon" class="mr-2 h-4 w-4" />
              {{ item.label }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </TooltipTrigger>
    <TooltipContent class="z-[100]">{{ props.tooltip }}</TooltipContent>
  </Tooltip>
</template>
