import type { ChatStatus, ModelMessage } from 'ai'
import type { FileDiff } from '@/types/harness/file-diff'
import type { SubagentResult } from '@/types/harness/subagent-record'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import { fileDiffListSchema } from '@/schemas/file-diff'
import buildTools from '@/services/harness/build-tools'
import formatToolValidationError from '@/services/harness/format-tool-validation-error'
import { MODE_TOOL_ALLOWLIST } from '@/services/harness/mode-allowlists'
import {
  PLAN_GO_BLOCKED_TOOLS,
  PLAN_GO_EXECUTE_GATE_TOOLS,
} from '@/services/harness/plan-execution-session'
import truncateToolResult from '@/utils/truncate-tool-result'

export type HarnessStatus = ChatStatus

export const nowIso = (): string => new Date().toISOString()

export const deriveToolDiffs = (result: unknown): FileDiff[] | undefined => {
  if (!result || typeof result !== 'object') {
    return undefined
  }
  const record = result as Record<string, unknown>
  if (!Array.isArray(record.diffs)) {
    return undefined
  }
  const parsed = fileDiffListSchema.safeParse(record.diffs)
  if (!parsed.success) {
    return undefined
  }
  return parsed.data
}

export const filterToolsForMode = (
  mode: VixlChatMode,
  tools: ReturnType<typeof buildTools>,
  options?: { awaitingPlanGo?: boolean },
): Partial<ReturnType<typeof buildTools>> => {
  const allow = new Set(MODE_TOOL_ALLOWLIST[mode])
  const entries = Object.entries(tools).filter(([name]) => {
    if (!allow.has(name)) {
      return false
    }
    if (
      options?.awaitingPlanGo &&
      PLAN_GO_BLOCKED_TOOLS.has(name) &&
      !PLAN_GO_EXECUTE_GATE_TOOLS.has(name)
    ) {
      return false
    }
    return true
  })
  return Object.fromEntries(entries) as Partial<ReturnType<typeof buildTools>>
}

export const resolveStreamError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error
  }
  return new Error('Model stream failed')
}

export const resolveToolErrorMessage = (error: unknown): string => {
  const validation = formatToolValidationError(error)
  if (validation) {
    return validation
  }
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  try {
    return JSON.stringify(error)
  } catch {
    return 'Tool execution failed'
  }
}

export const injectContextIntoLastUserMessage = (
  modelMessages: ModelMessage[],
  contextText: string,
): ModelMessage[] => {
  if (!contextText.trim()) {
    return modelMessages
  }
  let lastUserIdx = -1
  for (let i = modelMessages.length - 1; i >= 0; i--) {
    const candidate = modelMessages[i]
    if (candidate?.role === 'user') {
      lastUserIdx = i
      break
    }
  }
  if (lastUserIdx === -1) {
    return modelMessages
  }
  const msg = modelMessages[lastUserIdx]
  if (!msg || msg.role !== 'user') {
    return modelMessages
  }
  const result = [...modelMessages]
  if (typeof msg.content === 'string') {
    result[lastUserIdx] = {
      ...msg,
      role: 'user',
      content: `${contextText}\n\n${msg.content}`,
    }
    return result
  }
  if (Array.isArray(msg.content)) {
    const parts = [...msg.content]
    const textIdx = parts.findIndex((part) => part.type === 'text')
    if (textIdx >= 0) {
      const existing = parts[textIdx]
      if (existing?.type === 'text') {
        parts[textIdx] = {
          ...existing,
          text: `${contextText}\n\n${existing.text ?? ''}`,
        }
        result[lastUserIdx] = { ...msg, role: 'user', content: parts }
      }
    } else {
      result[lastUserIdx] = {
        ...msg,
        role: 'user',
        content: [{ type: 'text', text: contextText }, ...parts],
      }
    }
    return result
  }
  return modelMessages
}

const patchSubagentToolResult = (
  messages: ModelMessage[],
  toolCallId: string,
  completedResult: SubagentResult,
): ModelMessage[] =>
  messages.map((message) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) {
      return message
    }
    return {
      ...message,
      content: message.content.map((part) => {
        if (part.type !== 'tool-result' || part.toolCallId !== toolCallId) {
          return part
        }
        const truncatedSummary = truncateToolResult(completedResult.summary)
        const summary =
          typeof truncatedSummary === 'string'
            ? truncatedSummary
            : completedResult.summary
        return {
          ...part,
          output: {
            type: 'json' as const,
            value: {
              subagentId: completedResult.subagentId,
              name: completedResult.name,
              summary,
            },
          },
        }
      }),
    }
  })

export const patchSubagentToolResults = (
  messages: ModelMessage[],
  completedResults: Array<{ toolCallId: string; result: SubagentResult }>,
): ModelMessage[] =>
  completedResults.reduce(
    (next, item) => patchSubagentToolResult(next, item.toolCallId, item.result),
    messages,
  )

export const mapMetaStatusToChatStatus = (
  metaStatus: 'idle' | 'running',
  isSubmitting: boolean,
): HarnessStatus => {
  if (isSubmitting) {
    return 'submitted'
  }
  if (metaStatus === 'running') {
    return 'streaming'
  }
  return 'ready'
}
