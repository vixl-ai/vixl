import type { ModelMessage } from 'ai'
import { toast } from 'vue-sonner'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { SubagentWorkspace } from '@/types/harness/subagent-record'
import { upsertChatLine } from '@/services/vixl/vixl-tauri'
import { nowIso } from '@/services/harness/orchestrator/helpers'
import {
  getSubagent,
  isBackgroundSubagent,
} from '@/services/harness/subagent/registry'

export const subagentResumeLineId = (subagentId: string): string =>
  `subagent-resume:${subagentId}`

export type SubagentResumeSnapshot = {
  projectSlug: string
  chatId: string
  subagentId: string
  toolCallId: string
  agentName: string
  blocking: boolean
  prompt: string
  model: string
  capabilities: 'read-only' | 'write'
  workspace?: SubagentWorkspace
  messages: ModelMessage[]
}

export const buildResumeSnapshot = (
  run: {
    ctx: { projectSlug: string; chatId: string }
    subagentId: string
    agentName: string
    prompt: string
    toolCallId: string
    model: string
    capabilities: 'read-only' | 'write'
    workspace?: SubagentWorkspace
  },
  messages: ModelMessage[],
): SubagentResumeSnapshot => ({
  projectSlug: run.ctx.projectSlug,
  chatId: run.ctx.chatId,
  subagentId: run.subagentId,
  toolCallId: run.toolCallId,
  agentName: run.agentName,
  blocking: !isBackgroundSubagent(run.subagentId),
  prompt: getSubagent(run.subagentId)?.prompt ?? run.prompt,
  model: run.model,
  capabilities: run.capabilities,
  ...(run.workspace ? { workspace: run.workspace } : {}),
  messages,
})

const chains = new Map<string, Promise<void>>()
const generations = new Map<string, number>()
const latestFailures = new Map<string, unknown>()
const chainChatIds = new Map<string, string>()
const pendingIds = new Set<string>()

const toastPersistError = (error: unknown): void => {
  toast.error('Failed to save subagent resume snapshot', {
    description: error instanceof Error ? error.message : 'Unknown error',
  })
}

const isCurrentGeneration = (subagentId: string, generation: number): boolean =>
  generations.get(subagentId) === generation

const recordOutcome = (
  subagentId: string,
  generation: number,
  error?: unknown,
): void => {
  if (!isCurrentGeneration(subagentId, generation)) {
    return
  }
  if (error === undefined) {
    latestFailures.delete(subagentId)
    return
  }
  latestFailures.set(subagentId, error)
}

const takeLatestFailure = (subagentId: string): unknown => {
  if (!latestFailures.has(subagentId)) {
    return undefined
  }
  const error = latestFailures.get(subagentId)
  latestFailures.delete(subagentId)
  return error
}

const throwIfLatestFailed = (subagentId: string): void => {
  const error = takeLatestFailure(subagentId)
  if (error !== undefined) {
    throw error
  }
}

const capturedOrNow = (capturedAt?: string): string =>
  typeof capturedAt === 'string' && capturedAt.length > 0
    ? capturedAt
    : nowIso()

export const persistSubagentResume = async (
  snapshot: SubagentResumeSnapshot,
  capturedAt?: string,
): Promise<void> => {
  const event: Extract<HarnessEvent, { type: 'subagent-resume' }> = {
    type: 'subagent-resume',
    subagentId: snapshot.subagentId,
    toolCallId: snapshot.toolCallId,
    agentName: snapshot.agentName,
    blocking: snapshot.blocking,
    prompt: snapshot.prompt,
    model: snapshot.model,
    capabilities: snapshot.capabilities,
    ...(snapshot.workspace ? { workspace: snapshot.workspace } : {}),
    messages: snapshot.messages,
  }
  await upsertChatLine(snapshot.projectSlug, snapshot.chatId, {
    id: subagentResumeLineId(snapshot.subagentId),
    role: 'assistant',
    parts: [],
    createdAt: capturedOrNow(capturedAt),
    harnessEvent: event,
  })
}

export const queueSubagentResumeSnapshot = (
  snapshot: SubagentResumeSnapshot,
  capturedAt?: string,
): void => {
  const createdAt = capturedOrNow(capturedAt)
  const nextGen = (generations.get(snapshot.subagentId) ?? 0) + 1
  generations.set(snapshot.subagentId, nextGen)
  chainChatIds.set(snapshot.subagentId, snapshot.chatId)
  pendingIds.add(snapshot.subagentId)
  const previous = chains.get(snapshot.subagentId) ?? Promise.resolve()
  const writeSnapshot = async (): Promise<void> => {
    try {
      if (!isCurrentGeneration(snapshot.subagentId, nextGen)) {
        return
      }
      try {
        await persistSubagentResume(snapshot, createdAt)
        recordOutcome(snapshot.subagentId, nextGen)
      } catch (error) {
        toastPersistError(error)
        recordOutcome(snapshot.subagentId, nextGen, error)
      }
    } finally {
      if (isCurrentGeneration(snapshot.subagentId, nextGen)) {
        pendingIds.delete(snapshot.subagentId)
      }
    }
  }
  const write = previous.then(writeSnapshot, writeSnapshot)
  chains.set(snapshot.subagentId, write)
}

export const flushSubagentResumePersist = async (
  subagentId?: string,
  chatId?: string,
): Promise<void> => {
  if (subagentId) {
    await (chains.get(subagentId) ?? Promise.resolve())
    throwIfLatestFailed(subagentId)
    return
  }
  const inFlightIds = chatId
    ? [...pendingIds].filter((id) => chainChatIds.get(id) === chatId)
    : [...pendingIds]
  await Promise.all(inFlightIds.map((id) => chains.get(id) ?? Promise.resolve()))
  for (const id of inFlightIds) {
    throwIfLatestFailed(id)
  }
}

export const resetSubagentResumePersistForTests = (): void => {
  chains.clear()
  generations.clear()
  latestFailures.clear()
  chainChatIds.clear()
  pendingIds.clear()
}
