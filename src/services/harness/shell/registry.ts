import { listen } from '@tauri-apps/api/event'
import { ref } from 'vue'
import { shellKillTracked, shellSpawnTracked } from '@/services/vixl/vixl-tauri'
import type { AgentShellRecord, AgentShellStatus } from '@/types/harness/agent-shell'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { ShellExitResult } from '@/types/harness/shell-exit'

type ShellOutputPayload = {
  shellId: string
  stream: 'stdout' | 'stderr'
  data: string
}

type ShellExitPayload = ShellExitResult & {
  shellId: string
}

type EventEmitter = (event: HarnessEvent) => void

const shells = new Map<string, AgentShellRecord>()
const chatShells = new Map<string, Set<string>>()
const exitWaiters = new Map<string, Array<(exit: ShellExitResult) => void>>()
const shellUnlisteners = new Map<string, Array<() => void>>()
const eventEmitters = new Map<string, EventEmitter>()

export const agentShellRevision = ref(0)

const bumpRevision = (): void => {
  agentShellRevision.value++
}

export const setAgentShellEventEmitter = (
  chatId: string,
  emitter: EventEmitter | null,
): void => {
  if (emitter) {
    eventEmitters.set(chatId, emitter)
    return
  }
  eventEmitters.delete(chatId)
}

const emitHarnessEvent = (chatId: string, event: HarnessEvent): void => {
  if (!eventEmitters.has(chatId)) {
    return
  }
  const emitter = eventEmitters.get(chatId)
  if (typeof emitter !== 'function') {
    return
  }
  emitter(event)
}

const setShellStatus = (
  shell: AgentShellRecord,
  status: AgentShellStatus,
  exit: ShellExitResult,
): void => {
  shell.status = status
  shell.exitCode = exit.exitCode
  shell.exitSignal = exit.signal ?? null
}

const appendOutput = (shellId: string, stream: 'stdout' | 'stderr', data: string): void => {
  const shell = shells.get(shellId)
  if (!shell) {
    return
  }

  if (stream === 'stdout') {
    shell.stdout = shell.stdout + data
  } else {
    shell.stderr = shell.stderr + data
  }

  emitHarnessEvent(shell.chatId, { type: 'terminal-output', shellId, stream, data })
  bumpRevision()
}

const resolveExitWaiters = (shellId: string, exit: ShellExitResult): void => {
  const waiters = exitWaiters.get(shellId) ?? []
  exitWaiters.delete(shellId)
  for (const resolve of waiters) {
    resolve(exit)
  }
}

const cleanupShellListeners = (shellId: string): void => {
  const unlisteners = shellUnlisteners.get(shellId) ?? []
  for (const unlisten of unlisteners) {
    unlisten()
  }
  shellUnlisteners.delete(shellId)
}

const markShellComplete = (shellId: string, exit: ShellExitResult): void => {
  const shell = shells.get(shellId)
  if (!shell || shell.status !== 'running') {
    return
  }

  setShellStatus(shell, exit.exitCode === 0 ? 'completed' : 'failed', exit)
  emitHarnessEvent(shell.chatId, { type: 'shell-complete', shellId, exitCode: exit.exitCode })
  bumpRevision()
  resolveExitWaiters(shellId, exit)
  cleanupShellListeners(shellId)
}

const registerShellListeners = async (shellId: string): Promise<void> => {
  const unlistenOutput = await listen<ShellOutputPayload>(`shell-output-${shellId}`, (event) => {
    appendOutput(shellId, event.payload.stream, event.payload.data)
  })

  const unlistenExit = await listen<ShellExitPayload>(`shell-exit-${shellId}`, (event) => {
    markShellComplete(shellId, {
      exitCode: event.payload.exitCode,
      signal: event.payload.signal,
    })
  })

  shellUnlisteners.set(shellId, [unlistenOutput, unlistenExit])
}

const trackShellForChat = (chatId: string, shellId: string): void => {
  const existing = chatShells.get(chatId) ?? new Set<string>()
  existing.add(shellId)
  chatShells.set(chatId, existing)
}

export const createAgentShell = async (args: {
  chatId: string
  projectRoot: string
  command: string
  sandboxed?: boolean
  allowNetwork?: boolean
}): Promise<AgentShellRecord> => {
  const shellId = crypto.randomUUID()
  const record: AgentShellRecord = {
    shellId,
    chatId: args.chatId,
    projectRoot: args.projectRoot,
    command: args.command,
    status: 'running',
    stdout: '',
    stderr: '',
    exitCode: null,
    exitSignal: null,
    startedAt: new Date().toISOString(),
  }

  shells.set(shellId, record)
  trackShellForChat(args.chatId, shellId)
  await registerShellListeners(shellId)
  await shellSpawnTracked({
    shellId,
    projectRoot: args.projectRoot,
    command: args.command,
    sandboxed: args.sandboxed,
    allowNetwork: args.allowNetwork,
  })
  bumpRevision()

  return record
}

export const waitForShellExit = (
  shellId: string,
  timeoutMs?: number,
): Promise<ShellExitResult & { timedOut: boolean }> => {
  const shell = shells.get(shellId)
  if (!shell) {
    return Promise.reject(new Error(`Shell not found: ${shellId}`))
  }

  const toExitResult = (): ShellExitResult => ({
    exitCode: shell.exitCode ?? -1,
    signal: shell.exitSignal ?? undefined,
  })

  if (shell.status !== 'running') {
    return Promise.resolve({
      ...toExitResult(),
      timedOut: false,
    })
  }

  return new Promise((resolve) => {
    const hasTimeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    const timer = hasTimeout
      ? setTimeout(() => {
          resolve({
            ...toExitResult(),
            timedOut: true,
          })
        }, timeoutMs)
      : null

    const onExit = (exit: ShellExitResult): void => {
      if (timer) {
        clearTimeout(timer)
      }
      resolve({ ...exit, timedOut: false })
    }

    const waiters = exitWaiters.get(shellId) ?? []
    waiters.push(onExit)
    exitWaiters.set(shellId, waiters)
  })
}

export const getAgentShell = (shellId: string): AgentShellRecord | null => shells.get(shellId) ?? null

export const listShellsForChat = (chatId: string): AgentShellRecord[] => {
  const shellIds = chatShells.get(chatId)
  if (!shellIds) {
    return []
  }
  return [...shellIds]
    .map((shellId) => shells.get(shellId))
    .filter((shell): shell is AgentShellRecord => shell !== undefined)
}

export const tailShellOutput = (
  shell: AgentShellRecord,
  tail?: number,
): { stdout: string; stderr: string } => {
  if (!tail || tail <= 0) {
    return { stdout: shell.stdout, stderr: shell.stderr }
  }

  const tailText = (text: string): string => text.split('\n').slice(-tail).join('\n')

  return {
    stdout: tailText(shell.stdout),
    stderr: tailText(shell.stderr),
  }
}

export const killAgentShell = async (shellId: string): Promise<AgentShellRecord> => {
  const shell = shells.get(shellId)
  if (!shell) {
    throw new Error(`Shell not found: ${shellId}`)
  }

  if (shell.status === 'running') {
    try {
      const exit = await shellKillTracked(shellId)
      markShellComplete(shellId, exit)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Backend may have already reaped the process between our status check and kill.
      if (!message.includes('Shell not found')) {
        throw error
      }
      if (shell.status === 'running') {
        const waitResult = await waitForShellExit(shellId, 5_000)
        markShellComplete(shellId, {
          exitCode: waitResult.exitCode,
          signal: waitResult.signal,
        })
      }
    }
  }

  bumpRevision()
  return shell
}

export const killShellsForChat = async (chatId: string): Promise<void> => {
  const shellIds = chatShells.get(chatId)
  if (!shellIds) {
    return
  }

  const toKill = [...shellIds]
  for (const shellId of toKill) {
    try {
      await killAgentShell(shellId)
    } catch {
      shells.delete(shellId)
      cleanupShellListeners(shellId)
    }
  }

  chatShells.delete(chatId)
}

export const resetAgentShellRegistryForTests = (): void => {
  for (const shellId of shellUnlisteners.keys()) {
    cleanupShellListeners(shellId)
  }
  shells.clear()
  chatShells.clear()
  exitWaiters.clear()
  eventEmitters.clear()
}
