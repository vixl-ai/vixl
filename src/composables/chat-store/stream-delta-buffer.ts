import type { ChatSession } from './types'

export const STREAM_DELTA_FLUSH_MS = 50

export type PendingStreamDeltaKind = 'text' | 'reasoning'

export type PendingStreamDelta = {
  kind: PendingStreamDeltaKind
  messageId?: string
  stepId?: string
  text: string
}

export type PendingStreamDeltaBuffer = {
  enqueue: (
    kind: PendingStreamDeltaKind,
    delta: string,
    messageId?: string,
    stepId?: string,
  ) => void
  flush: () => void
  clear: () => void
  dispose: () => void
}

const buffersBySession = new WeakMap<ChatSession, PendingStreamDeltaBuffer>()
const liveBuffers = new Set<PendingStreamDeltaBuffer>()

export const clearPendingStreamDeltasForSession = (session: ChatSession): void => {
  buffersBySession.get(session)?.clear()
}

export const disposeAllPendingStreamDeltas = (): void => {
  for (const buffer of liveBuffers) {
    buffer.dispose()
  }
}

export const createPendingStreamDeltaBuffer = (
  session: ChatSession,
  apply: (entry: PendingStreamDelta) => void,
): PendingStreamDeltaBuffer => {
  const entries: PendingStreamDelta[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let flushing = false

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
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
    const batch = entries.splice(0, entries.length)
    flushing = true
    try {
      for (const entry of batch) {
        apply(entry)
      }
    } finally {
      flushing = false
    }
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
    kind: PendingStreamDeltaKind,
    delta: string,
    messageId?: string,
    stepId?: string,
  ): void => {
    if (disposed || !delta) {
      return
    }
    const last = entries.at(-1)
    if (
      last &&
      last.kind === kind &&
      last.messageId === messageId &&
      last.stepId === stepId
    ) {
      last.text += delta
    } else {
      entries.push({ kind, messageId, stepId, text: delta })
    }
    scheduleFlush()
  }

  const buffer: PendingStreamDeltaBuffer = {
    enqueue,
    flush,
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
