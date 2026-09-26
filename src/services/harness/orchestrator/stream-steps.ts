import type { HarnessEvent } from '@/types/harness/harness-event'
import type { HarnessWorkspace } from '@/types/harness/harness-workspace'
import deriveToolArtifact from '@/services/harness/derive-tool-artifact'
import parseTodoUpdate from '@/services/harness/parse-todo-update'
import truncateToolResult from '@/utils/truncate-tool-result'
import { deriveToolDiffs } from './helpers'
import {
  persistStepBoundary,
  persistStepText,
  persistTodoUpdate,
  persistToolRun,
} from './persistence'

type StepControllerOptions = {
  workspace: HarnessWorkspace
  chatId: string
  onEvent: (event: HarnessEvent) => void
}

export default (options: StepControllerOptions) => {
  const { workspace, chatId, onEvent } = options
  const persistSlug = (): string => workspace.projectSlug

  let trailingText = ''
  let assistantReasoning = ''
  let stepCount = 0
  let currentStepId = ''
  let currentStepText = ''
  let collectedStepText = ''
  let stepOpen = false
  let reasoningStartedAt: number | null = null
  let reasoningSealed = false
  let sealedReasoningSeconds = 0
  const startedToolIds = new Set<string>()
  const completedToolIds = new Set<string>()

  const resetReasoningClock = (): void => {
    reasoningStartedAt = null
    reasoningSealed = false
  }

  const sealReasoningDuration = (): void => {
    if (reasoningSealed || !currentStepId) {
      return
    }
    reasoningSealed = true
    if (reasoningStartedAt === null) {
      return
    }
    const elapsedMs = Date.now() - reasoningStartedAt
    const seconds = Math.max(1, Math.ceil(elapsedMs / 1000))
    sealedReasoningSeconds += seconds
    onEvent({ type: 'reasoning-duration', stepId: currentStepId, seconds })
  }

  const noteReasoningDelta = (): void => {
    if (reasoningStartedAt === null && !reasoningSealed) {
      reasoningStartedAt = Date.now()
    }
  }

  const beginStep = async (): Promise<void> => {
    if (stepOpen) {
      await finishStep()
    }
    currentStepId = crypto.randomUUID()
    currentStepText = ''
    stepOpen = true
    resetReasoningClock()
    onEvent({ type: 'step-start', stepId: currentStepId })
    await persistStepBoundary(persistSlug(), chatId, currentStepId, 'start')
  }

  const finishStep = async (): Promise<void> => {
    if (!stepOpen) {
      return
    }
    sealReasoningDuration()
    if (currentStepText.trim()) {
      collectedStepText = collectedStepText
        ? `${collectedStepText}\n\n${currentStepText}`
        : currentStepText
      await persistStepText(persistSlug(), chatId, currentStepId, currentStepText)
    }
    onEvent({ type: 'step-finish', stepId: currentStepId })
    await persistStepBoundary(persistSlug(), chatId, currentStepId, 'finish')
    stepCount += 1
    currentStepText = ''
    stepOpen = false
  }

  const ensureStepOpen = async (): Promise<void> => {
    if (!stepOpen) {
      await beginStep()
    }
  }

  const emitToolStart = async (
    toolCallId: string,
    name: string,
    args: unknown,
  ): Promise<void> => {
    if (startedToolIds.has(toolCallId)) {
      return
    }
    startedToolIds.add(toolCallId)
    sealReasoningDuration()
    onEvent({ type: 'tool-start', toolCallId, name, args })
    await persistToolRun(
      persistSlug(),
      chatId,
      toolCallId,
      name,
      'running',
      currentStepId,
      args,
    )
  }

  const emitToolResult = async (
    toolCallId: string,
    name: string,
    result: unknown,
    isError = false,
    args?: unknown,
  ): Promise<void> => {
    if (completedToolIds.has(toolCallId)) {
      return
    }
    completedToolIds.add(toolCallId)
    const truncated = isError ? result : truncateToolResult(result)
    const artifact = deriveToolArtifact(name, truncated, args, isError)
    const diffs = isError ? undefined : deriveToolDiffs(truncated)
    onEvent({
      type: 'tool-result',
      toolCallId,
      result: truncated,
      isError,
      ...(artifact ? { artifact } : {}),
      ...(diffs ? { diffs } : {}),
    })
    await persistToolRun(
      persistSlug(),
      chatId,
      toolCallId,
      name,
      isError ? 'error' : 'done',
      currentStepId,
      args,
      truncated,
      artifact,
      diffs,
    )
    if (!isError) {
      const todos = parseTodoUpdate(name, truncated)
      if (todos) {
        onEvent({ type: 'todo-update', todos })
        await persistTodoUpdate(persistSlug(), chatId, todos)
      }
    }
  }

  return {
    get trailingText() {
      return trailingText
    },
    set trailingText(value: string) {
      trailingText = value
    },
    get assistantReasoning() {
      return assistantReasoning
    },
    set assistantReasoning(value: string) {
      assistantReasoning = value
    },
    get stepCount() {
      return stepCount
    },
    get currentStepId() {
      return currentStepId
    },
    get currentStepText() {
      return currentStepText
    },
    set currentStepText(value: string) {
      currentStepText = value
    },
    get collectedStepText() {
      return collectedStepText
    },
    get stepOpen() {
      return stepOpen
    },
    get sealedReasoningSeconds() {
      return sealedReasoningSeconds
    },
    beginStep,
    finishStep,
    ensureStepOpen,
    emitToolStart,
    emitToolResult,
    noteReasoningDelta,
    sealReasoningDuration,
  }
}
