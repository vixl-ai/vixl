<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  CircleAlert,
  CircleCheck,
  Database,
  GitBranch,
  Loader2,
  RefreshCw,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import useCodegraphStatus from '@/composables/use-codegraph-status'
import useFleetRegistry from '@/composables/use-fleet-registry'
import projectRouteFor from '@/utils/project-route-for'
import { shouldShowChatCodegraphStatusChip } from './chat-codegraph-status-chip'

const route = useRoute()
const router = useRouter()
const fleet = useFleetRegistry()
const codegraph = useCodegraphStatus()
const open = ref(false)
const navigating = ref(false)

const projectSlug = computed(() => fleet.activeProject.value?.slug ?? null)
const visible = computed(() =>
  shouldShowChatCodegraphStatusChip({
    routeName: route.name,
    routeSlug: String(route.params.slug ?? ''),
    activeProjectSlug: projectSlug.value,
  }),
)

const statusClass = computed((): string => {
  if (codegraph.isBusy.value) {
    return 'text-amber-600 dark:text-amber-400'
  }
  switch (codegraph.state.value) {
    case 'ready':
      return 'text-emerald-600 dark:text-emerald-400'
    case 'error':
      return 'text-destructive'
    case 'indexing':
    case 'syncing':
      return 'text-amber-600 dark:text-amber-400'
    case 'idle':
    default:
      return 'text-muted-foreground'
  }
})

const triggerTooltip = computed(() => {
  if (codegraph.errorMessage.value) {
    return codegraph.errorMessage.value
  }
  switch (codegraph.state.value) {
    case 'indexing':
      return 'Graph indexing'
    case 'syncing':
      return 'Graph syncing'
    case 'error':
      return 'Graph error'
    case 'ready':
      return 'Graph'
    case 'idle':
    default:
      return 'Graph offline'
  }
})

const handleOpenCodegraph = async (): Promise<void> => {
  const slug = projectSlug.value
  if (!slug) {
    return
  }
  navigating.value = true
  try {
    open.value = false
    await router.push(projectRouteFor(slug, 'codegraph'))
  } catch (error) {
    toast.error('Failed to open Graph', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    navigating.value = false
  }
}

const handleRefresh = async (): Promise<void> => {
  try {
    await codegraph.refresh()
  } catch (error) {
    toast.error('Failed to refresh Graph status', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

watch(open, async (isOpen) => {
  if (!isOpen) {
    return
  }
  await handleRefresh()
})
</script>

<template>
  <Tooltip
    v-if="visible"
    :disable-closing-trigger="true"
  >
    <TooltipTrigger as-child>
      <span class="inline-flex shrink-0">
        <DropdownMenu v-model:open="open">
          <DropdownMenuTrigger as-child>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              class="h-7 w-7 shrink-0"
              :class="statusClass"
              :disabled="navigating"
              :aria-label="triggerTooltip"
            >
              <Loader2
                v-if="codegraph.isBusy.value"
                class="size-4 animate-spin"
                aria-hidden="true"
              />
              <CircleAlert
                v-else-if="codegraph.state.value === 'error'"
                class="size-4"
                aria-hidden="true"
              />
              <CircleCheck
                v-else-if="codegraph.state.value === 'ready'"
                class="size-4"
                aria-hidden="true"
              />
              <Database
                v-else
                class="size-4"
                aria-hidden="true"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            class="w-auto min-w-0 p-1"
          >
            <div class="flex items-center gap-0.5">
              <Tooltip :disable-closing-trigger="true">
                <TooltipTrigger as-child>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 shrink-0"
                    :disabled="codegraph.pending.value"
                    aria-label="Refresh Graph"
                    @click="handleRefresh"
                  >
                    <RefreshCw
                      class="size-4"
                      :class="codegraph.pending.value ? 'animate-spin' : ''"
                      aria-hidden="true"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent class="z-[100]">Refresh</TooltipContent>
              </Tooltip>
              <Tooltip :disable-closing-trigger="true">
                <TooltipTrigger as-child>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    class="h-7 w-7 shrink-0"
                    :disabled="navigating"
                    aria-label="Open Graph"
                    @click="handleOpenCodegraph"
                  >
                    <GitBranch
                      class="size-4"
                      aria-hidden="true"
                    />
                  </Button>
                </TooltipTrigger>
                <TooltipContent class="z-[100]">Open Graph</TooltipContent>
              </Tooltip>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </TooltipTrigger>
    <TooltipContent class="z-[100]">{{ triggerTooltip }}</TooltipContent>
  </Tooltip>
</template>
