<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { toast } from 'vue-sonner'
import {
  FileCode,
  Terminal,
} from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
const route = useRoute()
const open = ref(false)
const contextSlug = computed(() => String(route.params.slug ?? ''))
const workspaceProjects = computed(() =>
  workbench.listWorkspaceProjects(contextSlug.value),
)
const isGroupWorkspace = computed(() => workspaceProjects.value.length > 1)

const activeProjectId = computed(() => fleet.activeProjectId.value)

const handleOpen = async (
  type: 'editor' | 'terminal',
  projectIdOverride?: string,
): Promise<void> => {
  const projectId =
    projectIdOverride
    ?? workbench.resolvePrimaryWorkspaceProjectId(contextSlug.value)

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
          <DropdownMenuContent align="start" class="z-[60] w-44">
            <DropdownMenuItem @click="handleOpen('editor')">
              <FileCode class="mr-2 h-4 w-4" />
              Editor
            </DropdownMenuItem>
            <DropdownMenuSub v-if="isGroupWorkspace">
              <DropdownMenuSubTrigger>
                <Terminal class="mr-2 h-4 w-4" />
                Terminal
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent class="z-[60] w-44">
                <DropdownMenuItem
                  v-for="project in workspaceProjects"
                  :key="project.id"
                  @click="handleOpen('terminal', project.id)"
                >
                  {{ project.slug }}
                </DropdownMenuItem>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              v-else
              @click="handleOpen('terminal')"
            >
              <Terminal class="mr-2 h-4 w-4" />
              Terminal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </TooltipTrigger>
    <TooltipContent class="z-[100]">{{ props.tooltip }}</TooltipContent>
  </Tooltip>
</template>
