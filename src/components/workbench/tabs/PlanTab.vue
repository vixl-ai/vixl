<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  Hammer,
  Network,
  XCircleIcon,
} from '@lucide/vue'
import { Markdown } from 'vue-stream-markdown'
import 'vue-stream-markdown/index.css'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/shadcn/ui/alert'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import WorkbenchPlansOrchestratePlanDialog from '@/components/workbench/plans/OrchestratePlanDialog.vue'
import StudioBlocksMermaid from '@/components/studio/blocks/StudioBlocksMermaid.vue'
import useVixlConfig from '@/composables/use-vixl-config'
import useStartPlanBuild from '@/composables/use-start-plan-build'
import useWorkbenchStore from '@/composables/use-workbench-store'
import parsePlan from '@/services/plans/parse-plan'
import listConfiguredProviders from '@/services/providers/list-configured-providers'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import { fsReadFile } from '@/services/vixl/vixl-tauri'
import type { PlanTodoItem } from '@/types/plans/plan-document'
import type { PlanPayload, WorkbenchTab } from '@/types/workbench/workbench-tab'

type PlanBodySegment =
  | { type: 'markdown'; content: string }
  | { type: 'mermaid'; content: string }

const MERMAID_FENCE_RE = /```mermaid\s*\n([\s\S]*?)```/g

const STATUS_LABELS: Record<PlanTodoItem['status'], string> = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

const props = defineProps<{
  tab: WorkbenchTab
}>()

const workbench = useWorkbenchStore()
const config = useVixlConfig()
const { building, startPlanBuild } = useStartPlanBuild()
const body = ref('')
const todos = ref<PlanTodoItem[]>([])
const title = ref('')
const sourceChatId = ref<string | null>(null)
const loading = ref(false)
const parseError = ref<string | null>(null)
const orchestrateOpen = ref(false)

const planPayload = computed(() => props.tab.payload as PlanPayload)
const projectRoot = computed(() => workbench.getProject(props.tab.projectId)?.rootPath ?? null)
const refreshToken = computed(() => workbench.tabRefreshTokens.value[props.tab.id] ?? 0)

const hasProviders = computed(
  () => listConfiguredProviders(config.effectiveSettings.value).length > 0,
)

const actionsDisabled = computed(
  () => loading.value || building.value || Boolean(parseError.value) || !hasProviders.value,
)

const allTodosDone = computed(
  () =>
    todos.value.length > 0 &&
    todos.value.every(
      (todo) => todo.status === 'completed' || todo.status === 'cancelled',
    ),
)

const bodySegments = computed((): PlanBodySegment[] => {
  const text = body.value
  if (!text.trim()) {
    return []
  }

  const segments: PlanBodySegment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(MERMAID_FENCE_RE)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      segments.push({ type: 'markdown', content: text.slice(lastIndex, start) })
    }
    segments.push({ type: 'mermaid', content: match[1] ?? '' })
    lastIndex = start + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'markdown', content: text.slice(lastIndex) })
  }

  if (segments.length === 0) {
    return [{ type: 'markdown', content: text }]
  }

  return segments
})

const statusIcon = (status: PlanTodoItem['status']) => {
  if (status === 'completed') {
    return CheckCircle2Icon
  }
  if (status === 'in_progress') {
    return CircleDotIcon
  }
  if (status === 'cancelled') {
    return XCircleIcon
  }
  if (status === 'pending') {
    return CircleDashedIcon
  }
  return CircleIcon
}

const statusClass = (status: PlanTodoItem['status']): string => {
  if (status === 'completed') {
    return 'text-emerald-500'
  }
  if (status === 'in_progress') {
    return 'text-primary'
  }
  if (status === 'cancelled') {
    return 'text-muted-foreground'
  }
  return 'text-muted-foreground'
}

const loadPlan = async (): Promise<void> => {
  const root = projectRoot.value
  if (!root) {
    return
  }

  loading.value = true
  parseError.value = null
  try {
    const result = await fsReadFile({ projectRoot: root, path: planPayload.value.path })
    const parsed = parsePlan(result.content)
    if (parsed.parseError) {
      parseError.value = parsed.parseError
      title.value = props.tab.label
      body.value = parsed.body
      todos.value = []
      sourceChatId.value = null
      return
    }

    title.value = parsed.frontmatter?.title ?? props.tab.label
    body.value = parsed.body
    todos.value = parsed.frontmatter?.todos ?? []
    sourceChatId.value = parsed.frontmatter?.sourceChatId ?? null
  } catch (error) {
    toast.error('Failed to load plan', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    loading.value = false
  }
}

const handleBuildNow = (): void => {
  if (!hasProviders.value) {
    toast.error('Configure a provider before building')
    return
  }

  const model = resolveModelForRole('agent', config.effectiveSettings.value)
  if (!model) {
    toast.error('Select a default Agent model in Settings before building')
    return
  }

  startPlanBuild({
    projectId: props.tab.projectId,
    planPath: planPayload.value.path,
    planTitle: title.value || props.tab.label,
    sourceChatId: sourceChatId.value,
    model,
    executionMode: 'agent',
  })
    .then(async (success) => {
      if (success) {
        await loadPlan()
      }
    })
    .catch((error) => {
      toast.error('Could not start plan build', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    })
}

const handleOpenOrchestrate = (): void => {
  if (!hasProviders.value) {
    toast.error('Configure a provider before orchestrating')
    return
  }
  orchestrateOpen.value = true
}

const handleOrchestrateConfirm = (payload: {
  parentModel: string
  subagentModel: string
}): void => {
  startPlanBuild({
    projectId: props.tab.projectId,
    planPath: planPayload.value.path,
    planTitle: title.value || props.tab.label,
    sourceChatId: sourceChatId.value,
    model: payload.parentModel,
    subagentModel: payload.subagentModel,
    executionMode: 'orchestrator',
  })
    .then(async (success) => {
      if (success) {
        await loadPlan()
      }
    })
    .catch((error) => {
      toast.error('Could not start orchestration', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    })
}

onMounted(() => {
  loadPlan().catch((error) => {
    toast.error('Failed to load plan', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  })
})

watch([planPayload, projectRoot, refreshToken], () => {
  loadPlan().catch((error) => {
    toast.error('Failed to load plan', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  })
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-y-auto">
    <div class="flex items-center justify-between gap-3 border-b border-border/50 px-4 py-3">
      <div class="min-w-0">
        <h2 class="text-sm font-semibold">{{ title || tab.label }}</h2>
        <p v-if="loading" class="text-xs text-muted-foreground">Loading…</p>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <Tooltip v-if="allTodosDone">
          <TooltipTrigger as-child>
            <span class="inline-flex shrink-0" aria-label="Done">
              <CheckCircle2Icon class="size-4 text-emerald-500" />
            </span>
          </TooltipTrigger>
          <TooltipContent class="z-60">Done</TooltipContent>
        </Tooltip>
        <template v-else>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                :disabled="actionsDisabled"
                aria-label="Orchestrate"
                @click="handleOpenOrchestrate"
              >
                <Network class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent class="z-60">Orchestrate</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                variant="ghost"
                size="icon"
                class="h-8 w-8"
                :disabled="actionsDisabled"
                aria-label="Build now"
                @click="handleBuildNow"
              >
                <Hammer class="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent class="z-60">Build now</TooltipContent>
          </Tooltip>
        </template>
      </div>
    </div>

    <Alert v-if="parseError" variant="destructive" class="m-4">
      <AlertTitle>Invalid plan document</AlertTitle>
      <AlertDescription>{{ parseError }}</AlertDescription>
    </Alert>

    <template v-else>
      <div v-if="todos.length > 0" class="border-b border-border/50 px-4 py-3">
        <p class="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">Todos</p>
        <ul class="space-y-1 text-sm">
          <li v-for="todo in todos" :key="todo.id" class="flex items-start gap-2">
            <Tooltip>
              <TooltipTrigger as-child>
                <span
                  class="mt-0.5 inline-flex shrink-0"
                  :aria-label="STATUS_LABELS[todo.status]"
                >
                  <component
                    :is="statusIcon(todo.status)"
                    class="size-3.5"
                    :class="statusClass(todo.status)"
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>{{ STATUS_LABELS[todo.status] }}</TooltipContent>
            </Tooltip>
            <span>{{ todo.content }}</span>
          </li>
        </ul>
      </div>

      <div class="min-h-0 flex-1 space-y-4 px-4 py-3 text-sm">
        <template v-for="(segment, index) in bodySegments" :key="index">
          <Markdown
            v-if="segment.type === 'markdown' && segment.content.trim()"
            :content="segment.content"
            :enable-animate="false"
          />
          <StudioBlocksMermaid v-else-if="segment.type === 'mermaid'" :code="segment.content" />
        </template>
      </div>
    </template>

    <WorkbenchPlansOrchestratePlanDialog
      v-model:open="orchestrateOpen"
      :disabled="building"
      @confirm="handleOrchestrateConfirm"
    />
  </div>
</template>
