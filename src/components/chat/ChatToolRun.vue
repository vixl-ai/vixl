<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRightIcon, XIcon } from '@lucide/vue'
import type { ChatArtifact } from '@/types/chat/chat-artifact'
import type { ToolRun } from '@/types/harness/tool-run'
import type { FileDiff } from '@/types/harness/file-diff'
import type { ApprovalResolution } from '@/services/harness/permission/approval-gate'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import countDiffLines from '@/utils/count-diff-lines'
import formatToolRunLabel from '@/utils/format-tool-run-label'
import { isTerminalToolName } from '@/utils/parse-terminal-tool-view'
import resolveFileDiffHunks from '@/utils/resolve-file-diff-hunks'
import AiElementsShimmerShimmer from '@/components/ai-elements/shimmer/Shimmer.vue'
import ChatArtifactLink from '@/components/chat/ChatArtifactLink.vue'
import ChatInlineFileDiff from '@/components/chat/InlineFileDiff.vue'
import ChatApprovalActions from '@/components/chat/ChatApprovalActions.vue'
import ChatTerminalToolRun from '@/components/chat/ChatTerminalToolRun.vue'
import { CommitFileAdditions, CommitFileDeletions } from '@/components/ai-elements/commit'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'

const CODEBASE_SPAN_TOOLS = new Set(['codebase_explore', 'codebase_search', 'codebase_impact'])

const MAX_CODEBASE_LINKS = 25

const props = defineProps<{
  run: ToolRun
  approval?: PendingApprovalView
}>()

const emit = defineEmits<{
  resolveApproval: [resolution: ApprovalResolution]
}>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object'

const lineSuffix = (startLine?: number, endLine?: number): string => {
  if (typeof startLine !== 'number' || startLine < 1) {
    return ''
  }
  if (typeof endLine === 'number' && endLine > startLine) {
    return `:${startLine}-${endLine}`
  }
  return `:${startLine}`
}

const formatDetail = (value: unknown): string => {
  if (value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const open = ref(false)

const hasArtifactChip = computed(
  () => props.run.artifact !== undefined && props.run.status === 'done',
)
const label = computed(() =>
  formatToolRunLabel(props.run, {
    omitPathHint: hasArtifactChip.value,
  }),
)
const isRunning = computed(() => props.run.status === 'running')
const isError = computed(() => props.run.status === 'error')
const isTerminalRun = computed(() => isTerminalToolName(props.run.name))
const hasDetails = computed(() => props.run.args !== undefined || props.run.result !== undefined)
const ownerTitle = computed((): string | null => {
  if (!isRecord(props.run.result)) {
    return null
  }
  const title = props.run.result.ownerTitle
  return typeof title === 'string' && title.length > 0 ? title : null
})
const diffs = computed((): FileDiff[] => props.run.diffs ?? [])
const hasDiffs = computed(() => diffs.value.length > 0 && props.run.status === 'done')
const showInput = computed(() => props.run.args !== undefined && !hasDiffs.value)
const argsText = computed(() => (showInput.value ? formatDetail(props.run.args) : ''))
const resultText = computed(() => formatDetail(props.run.result))

const codebaseArtifacts = computed((): ChatArtifact[] => {
  if (
    props.run.status !== 'done' ||
    !CODEBASE_SPAN_TOOLS.has(props.run.name) ||
    !isRecord(props.run.result) ||
    !Array.isArray(props.run.result.results)
  ) {
    return []
  }

  const artifacts: ChatArtifact[] = []
  for (const entry of props.run.result.results) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || entry.path.length === 0) {
      continue
    }
    const startLine =
      typeof entry.startLine === 'number' && Number.isFinite(entry.startLine)
        ? Math.max(1, Math.trunc(entry.startLine))
        : undefined
    const endLine =
      typeof entry.endLine === 'number' && Number.isFinite(entry.endLine)
        ? Math.max(1, Math.trunc(entry.endLine))
        : startLine
    const fileName = entry.path.split('/').pop() ?? entry.path
    const suffix = lineSuffix(startLine, endLine)
    const symbol =
      typeof entry.symbol === 'string' && entry.symbol.length > 0 ? entry.symbol : undefined
    const artifact: ChatArtifact = {
      kind: 'file',
      path: entry.path,
      label: symbol ? `${symbol} (${fileName}${suffix})` : `${fileName}${suffix}`,
    }
    if (typeof startLine === 'number') {
      artifact.startLine = startLine
    }
    if (typeof endLine === 'number') {
      artifact.endLine = endLine
    }
    artifacts.push(artifact)
    if (artifacts.length >= MAX_CODEBASE_LINKS) {
      break
    }
  }
  return artifacts
})

const showRawOutput = computed(
  () =>
    resultText.value.length > 0 &&
    (props.run.status === 'done' || props.run.status === 'error') &&
    diffs.value.length === 0 &&
    codebaseArtifacts.value.length === 0,
)
const diffCounts = computed(() => {
  let additions = 0
  let deletions = 0
  for (const diff of diffs.value) {
    const counts = countDiffLines(resolveFileDiffHunks(diff))
    additions += counts.additions
    deletions += counts.deletions
  }
  return { additions, deletions }
})
</script>

<template>
  <ChatTerminalToolRun
    v-if="isTerminalRun"
    :run="run"
    :approval="approval"
    @resolve-approval="emit('resolveApproval', $event)"
  />
  <Collapsible v-else v-model:open="open" class="w-full min-w-0 max-w-full">
    <div class="flex w-full min-w-0 items-center gap-1">
      <CollapsibleTrigger
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md py-0.5 text-left text-sm transition-colors hover:text-foreground"
        :class="isError ? 'text-destructive/90' : 'text-muted-foreground'"
      >
        <XIcon v-if="isError" class="size-3.5 shrink-0 text-destructive" />
        <ChevronRightIcon
          v-else
          class="size-3.5 shrink-0 transition-transform"
          :class="open ? 'rotate-90' : ''"
        />
        <AiElementsShimmerShimmer
          v-if="isRunning"
          :duration="1"
          as="span"
          class="min-w-0 truncate"
        >
          {{ label }}
        </AiElementsShimmerShimmer>
        <span v-else class="min-w-0 truncate">{{ label }}</span>
        <ChatArtifactLink v-if="run.artifact && hasArtifactChip" :artifact="run.artifact" />
        <span
          v-if="hasDiffs && (diffCounts.additions > 0 || diffCounts.deletions > 0)"
          class="flex shrink-0 items-center gap-1.5 tabular-nums"
        >
          <CommitFileAdditions
            :count="diffCounts.additions"
            class="inline-flex items-center gap-0.5 text-[11px]"
          />
          <CommitFileDeletions
            :count="diffCounts.deletions"
            class="inline-flex items-center gap-0.5 text-[11px]"
          />
        </span>
      </CollapsibleTrigger>
      <ChatApprovalActions
        v-if="approval"
        :approval="approval"
        @resolve="emit('resolveApproval', $event)"
      />
    </div>
    <CollapsibleContent
      class="mt-1 space-y-2 border-l border-border/60 pl-5 text-xs text-muted-foreground"
    >
      <AiElementsShimmerShimmer
        v-if="isRunning && !hasDetails"
        :duration="1.5"
        as="p"
        class="text-muted-foreground"
      >
        Running…
      </AiElementsShimmerShimmer>
      <p v-if="ownerTitle" class="text-muted-foreground">Held by {{ ownerTitle }}</p>
      <div v-if="argsText">
        <p class="mb-1 font-medium text-foreground/80">Input</p>
        <pre class="max-h-40 overflow-auto whitespace-pre-wrap wrap-break-word">{{ argsText }}</pre>
      </div>
      <div v-if="hasDiffs" class="space-y-2">
        <ChatInlineFileDiff v-for="diff in diffs" :key="diff.path" :diff="diff" />
      </div>
      <div v-if="codebaseArtifacts.length > 0" class="space-y-1">
        <p class="mb-1 font-medium text-foreground/80">Locations</p>
        <ul class="flex flex-col gap-1">
          <li
            v-for="(artifact, index) in codebaseArtifacts"
            :key="`${artifact.path}:${artifact.startLine ?? 0}:${index}`"
          >
            <ChatArtifactLink :artifact="artifact" />
          </li>
        </ul>
      </div>
      <div v-if="showRawOutput">
        <p class="mb-1 font-medium text-foreground/80">Output</p>
        <pre class="max-h-48 overflow-auto whitespace-pre-wrap wrap-break-word">{{
          resultText
        }}</pre>
      </div>
    </CollapsibleContent>
  </Collapsible>
</template>
