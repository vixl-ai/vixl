import type { ChatSession } from './types'
import { STREAM_DELTA_FLUSH_MS } from './stream-delta-buffer'

export type PendingSubagentStreamDeltaKind = 'text' | 'reasoning'

export type PendingSubagentStreamDelta = {
  subagentId: string
  kind: PendingSubagentStreamDeltaKind
  stepId?: string
  text: string
}

export type PendingSubagentStreamDeltaBuffer = {
  enqueue: (
    subagentId: string,
    kind: PendingSubagentStreamDeltaKind,
    delta: string,
    stepId?: string,
  ) => void
  flush: () => void
  flushSubagent: (subagentId: string) => void
  clear: () => void
  dispose: () => void
}

const buffersBySession = new WeakMap<ChatSession, PendingSubagentStreamDeltaBuffer>()
const liveBuffers = new Set<PendingSubagentStreamDeltaBuffer>()

export const clearPendingSubagentStreamDeltasForSession = (
  session: ChatSession,
): void => {
  buffersBySession.get(session)?.clear()
}

export const disposeAllPendingSubagentStreamDeltas = (): void => {
  for (const buffer of liveBuffers) {
    buffer.dispose()
  }
}

export const createPendingSubagentStreamDeltaBuffer = (
  session: ChatSession,
  apply: (entry: PendingSubagentStreamDelta) => void,
): PendingSubagentStreamDeltaBuffer => {
  const entries: PendingSubagentStreamDelta[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let flushing = false

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const applyBatch = (batch: PendingSubagentStreamDelta[]): void => {
    if (batch.length === 0) {
      return
    }
    flushing = true
    try {
      for (const entry of batch) {
        apply(entry)
      }
    } finally {
      flushing = false
    }
  }

  const flush = (): void => {
    if (flushing) {
      return
    }
    clearTimer()
    if (entries.length === 0) {
      return
    }
    applyBatch(entries.splice(0, entries.length))
  }

  const flushSubagent = (subagentId: string): void => {
    if (flushing) {
      return
    }
    const kept: PendingSubagentStreamDelta[] = []
    const batch: PendingSubagentStreamDelta[] = []
    for (const entry of entries) {
      if (entry.subagentId === subagentId) {
        batch.push(entry)
      } else {
        kept.push(entry)
      }
    }
    if (batch.length === 0) {
      return
    }
    entries.length = 0
    entries.push(...kept)
    if (entries.length === 0) {
      clearTimer()
    }
    applyBatch(batch)
  }

  const clear = (): void => {
    clearTimer()
    entries.length = 0
  }

  const scheduleFlush = (): void => {
    if (disposed || timer !== null) {
      return
    }
    timer = setTimeout(() => {
      timer = null
      flush()
    }, STREAM_DELTA_FLUSH_MS)
  }

  const enqueue = (
    subagentId: string,
    kind: PendingSubagentStreamDeltaKind,
    delta: string,
    stepId?: string,
  ): void => {
    if (disposed || !delta) {
      return
    }
    const last = entries.at(-1)
    if (
      last &&
      last.subagentId === subagentId &&
      last.kind === kind &&
      last.stepId === stepId
    ) {
      last.text += delta
    } else {
      entries.push({ subagentId, kind, stepId, text: delta })
    }
    scheduleFlush()
  }

  const buffer: PendingSubagentStreamDeltaBuffer = {
    enqueue,
    flush,
    flushSubagent,
    clear,
    dispose: (): void => {
      clear()
      disposed = true
      liveBuffers.delete(buffer)
    },
  }
  buffersBySession.set(session, buffer)
  liveBuffers.add(buffer)
  return buffer
}
