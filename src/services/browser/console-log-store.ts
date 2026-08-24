import type CdpClient from '@/services/browser/cdp-client'
import { appendTempLog } from '@/services/vixl/vixl-tauri'

type CaptureHandle = {
  logFile: string
  stop: () => void
}

type ConsoleApiCalledParams = {
  type?: string
  args?: Array<{
    type?: string
    value?: unknown
    description?: string
    unserializableValue?: string
  }>
  timestamp?: number
}

type LogEntryAddedParams = {
  entry?: {
    source?: string
    level?: string
    text?: string
    timestamp?: number
  }
}

type NetworkResponseReceivedParams = {
  response?: {
    url?: string
    status?: number
    mimeType?: string
  }
  type?: string
}

type CaptureState = {
  path: string | null
  stopped: boolean
  writeFailures: number
}

const formatArg = (arg: {
  type?: string
  value?: unknown
  description?: string
  unserializableValue?: string
}): string => {
  if (typeof arg.value === 'string') {
    return arg.value
  }
  if (typeof arg.value === 'number' || typeof arg.value === 'boolean') {
    return String(arg.value)
  }
  if (arg.value === null) {
    return 'null'
  }
  if (typeof arg.description === 'string') {
    return arg.description
  }
  if (typeof arg.unserializableValue === 'string') {
    return arg.unserializableValue
  }
  if (typeof arg.type === 'string') {
    return `[${arg.type}]`
  }
  return '[unknown]'
}

const matchesSession = (eventSessionId: string | undefined, sessionId: string): boolean =>
  eventSessionId === undefined || eventSessionId === sessionId

const appendLine = async (state: CaptureState, kind: string, line: string): Promise<void> => {
  if (state.stopped || state.writeFailures >= 3) {
    return
  }
  try {
    const result = await appendTempLog({
      path: state.path,
      kind,
      line,
    })
    state.path = result.path
    state.writeFailures = 0
  } catch {
    state.writeFailures += 1
    if (state.writeFailures >= 3) {
      state.stopped = true
    }
  }
}

const ensureLogFile = async (state: CaptureState, kind: string): Promise<void> => {
  await appendLine(state, kind, `# ${kind} capture started ${new Date().toISOString()}`)
}

export const startConsoleLogCapture = (
  client: CdpClient,
  sessionId: string,
  workspaceId: string,
): CaptureHandle => {
  const kind = `browser-console-${workspaceId}`
  const state: CaptureState = {
    path: null,
    stopped: false,
    writeFailures: 0,
  }

  ensureLogFile(state, kind).catch(() => {
    state.writeFailures += 1
  })

  const unsubConsole = client.on('Runtime.consoleAPICalled', (params, eventSessionId) => {
    if (!matchesSession(eventSessionId, sessionId)) {
      return
    }
    const payload = (params ?? {}) as ConsoleApiCalledParams
    const level = typeof payload.type === 'string' ? payload.type : 'log'
    const args = Array.isArray(payload.args) ? payload.args.map(formatArg).join(' ') : ''
    const timestamp =
      typeof payload.timestamp === 'number'
        ? new Date(payload.timestamp).toISOString()
        : new Date().toISOString()
    appendLine(state, kind, `[${timestamp}] console.${level}: ${args}`).catch(() => {
      state.writeFailures += 1
    })
  })

  const unsubLog = client.on('Log.entryAdded', (params, eventSessionId) => {
    if (!matchesSession(eventSessionId, sessionId)) {
      return
    }
    const entry = ((params ?? {}) as LogEntryAddedParams).entry ?? {}
    const level = typeof entry.level === 'string' ? entry.level : 'info'
    const source = typeof entry.source === 'string' ? entry.source : 'log'
    const text = typeof entry.text === 'string' ? entry.text : ''
    const timestamp =
      typeof entry.timestamp === 'number'
        ? new Date(entry.timestamp).toISOString()
        : new Date().toISOString()
    appendLine(state, kind, `[${timestamp}] ${source}.${level}: ${text}`).catch(() => {
      state.writeFailures += 1
    })
  })

  client.send('Runtime.enable', {}, sessionId).catch(() => {
    state.writeFailures += 1
  })
  client.send('Log.enable', {}, sessionId).catch(() => {
    state.writeFailures += 1
  })

  return {
    get logFile() {
      return state.path ?? ''
    },
    stop: () => {
      state.stopped = true
      unsubConsole()
      unsubLog()
    },
  }
}

export const startNetworkLogCapture = (
  client: CdpClient,
  sessionId: string,
  workspaceId: string,
): CaptureHandle => {
  const kind = `browser-network-${workspaceId}`
  const state: CaptureState = {
    path: null,
    stopped: false,
    writeFailures: 0,
  }

  ensureLogFile(state, kind).catch(() => {
    state.writeFailures += 1
  })

  client.send('Network.enable', {}, sessionId).catch(() => {
    state.writeFailures += 1
  })

  const unsub = client.on('Network.responseReceived', (params, eventSessionId) => {
    if (!matchesSession(eventSessionId, sessionId)) {
      return
    }
    const payload = (params ?? {}) as NetworkResponseReceivedParams
    const response = payload.response ?? {}
    const url = typeof response.url === 'string' ? response.url : ''
    const status = typeof response.status === 'number' ? String(response.status) : '?'
    const mime = typeof response.mimeType === 'string' ? response.mimeType : ''
    const resourceType = typeof payload.type === 'string' ? payload.type : 'Other'
    const timestamp = new Date().toISOString()
    appendLine(state, kind, `[${timestamp}] ${resourceType} ${status} ${mime} ${url}`).catch(() => {
      state.writeFailures += 1
    })
  })

  return {
    get logFile() {
      return state.path ?? ''
    },
    stop: () => {
      state.stopped = true
      unsub()
    },
  }
}
