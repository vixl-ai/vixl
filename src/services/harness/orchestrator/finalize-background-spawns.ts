import type { ModelMessage } from 'ai'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { SubagentResult } from '@/types/harness/subagent-record'
import {
  getSubagent,
  isBackgroundResultFinalized,
  markBackgroundResultsFinalized,
} from '@/services/harness/subagent/registry'
import { persistToolRun } from './persistence'

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const readSpawnToolInput = (
  messages: ModelMessage[],
  toolCallId: string,
): Record<string, unknown> | null => {
  for (const message of messages) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) {
      continue
    }
    for (const part of message.content) {
      if (part.type !== 'tool-call' || part.toolCallId !== toolCallId) {
        continue
      }
      if (isPlainRecord(part.input)) {
        return part.input
      }
    }
  }
  return null
}

export const persistedSpawnArgs = (
  toolCallId: string,
  result: { name: string; subagentId: string },
  turnMessages: ModelMessage[] | null,
): Record<string, unknown> => {
  const fromTurn = turnMessages
    ? readSpawnToolInput(turnMessages, toolCallId)
    : null
  const record = getSubagent(result.subagentId)
  const prompt =
    (typeof fromTurn?.prompt === 'string' && fromTurn.prompt) || record?.prompt
  const mode = fromTurn?.mode
  const capabilities =
    (typeof fromTurn?.capabilities === 'string' && fromTurn.capabilities) ||
    record?.capabilities
  return {
    agentName:
      (typeof fromTurn?.agentName === 'string' && fromTurn.agentName) ||
      record?.agentName ||
      result.name,
    blocking: false,
    ...(prompt ? { prompt } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(capabilities ? { capabilities } : {}),
  }
}

const isLiveRegistryResult = (
  item: { toolCallId: string; result: SubagentResult },
): boolean => getSubagent(item.result.subagentId)?.result === item.result

export const finalizeBackgroundSpawnResults = async (
  projectSlug: string,
  chatId: string,
  completedResults: Array<{ toolCallId: string; result: SubagentResult }>,
  onEvent: (event: HarnessEvent) => void | Promise<void>,
  turnMessages: ModelMessage[] | null,
): Promise<Array<{ toolCallId: string; result: SubagentResult }>> => {
  const finalized: Array<{ toolCallId: string; result: SubagentResult }> = []
  for (const item of completedResults) {
    if (isBackgroundResultFinalized(chatId, item.toolCallId)) {
      // Already emitted and persisted. Keep it in the returned set only while
      // the snapshotted object is still the live registry result.
      if (isLiveRegistryResult(item)) {
        finalized.push(item)
      }
      continue
    }
    // Object identity: reopen() clears result, then resolve/fail assigns a
    // new object on the same toolCallId. Skip a snapshotted outcome that is
    // no longer live so a steered finish stays wakeable.
    if (!isLiveRegistryResult(item)) {
      continue
    }
    onEvent({
      type: 'tool-result',
      toolCallId: item.toolCallId,
      result: item.result,
      isError: false,
    })
    await persistToolRun(
      projectSlug,
      chatId,
      item.toolCallId,
      'spawn_subagent',
      'done',
      '',
      persistedSpawnArgs(item.toolCallId, item.result, turnMessages),
      item.result,
    )
    // Steer/reopen during persist rewrites the live result. Leave this
    // toolCallId unfinalized so the newer object can be finalized later.
    if (!isLiveRegistryResult(item)) {
      continue
    }
    markBackgroundResultsFinalized(chatId, [item.toolCallId])
    finalized.push(item)
  }
  return finalized
}
