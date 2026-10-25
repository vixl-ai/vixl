import { describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

vi.mock('@/services/harness/permission/gate', () => ({
  gateToolPermission: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
}))

vi.mock('@/services/harness/shell/registry', () => ({
  createAgentShell: vi.fn<
    (args: { chatId: string; projectRoot: string; command: string }) => Promise<{
      shellId: string
      status: string
      stdout: string
      stderr: string
      exitCode: number | null
      chatId: string
      projectRoot: string
      command: string
      startedAt: string
    }>
  >(),
  getAgentShell: vi.fn<(shellId: string) => unknown>(),
  killAgentShell: vi.fn<(shellId: string) => Promise<unknown>>(),
  tailShellOutput: vi.fn<
    (shell: { stdout: string; stderr: string }, tail?: number) => {
      stdout: string
      stderr: string
    }
  >(),
  waitForShellExit: vi.fn<
    (
      shellId: string,
      timeoutMs?: number,
    ) => Promise<{ exitCode: number; signal?: number; timedOut: boolean }>
  >(),
  killShellsForChat: vi.fn<() => Promise<void>>(),
  setAgentShellEventEmitter: vi.fn<(chatId: string, handler: unknown) => void>(),
}))

import runTerminal from '@/services/harness/shell/run-terminal'

describe('run_terminal input schema order', () => {
  const ctx = {
    projectRoot: '/project',
    projectSlug: 'project',
    chatId: 'chat-1',
    mode: 'agent' as const,
    userMessageId: 'user-1',
    settings: { version: 1 } as VixlSettings,
    permissionLevel: 'ask' as const,
    sessionAllows: new Set<string>(),
    sessionDenies: new Set<string>(),
    sandboxEnabled: false,
    supportsVision: false,
    onPendingApproval: vi.fn<(entry: PendingApprovalView) => void>(),
  }

  it('puts description first on the input schema', () => {
    const built = runTerminal(ctx)
    const schema = built.inputSchema as unknown as {
      shape: Record<string, unknown>
    }
    expect(Object.keys(schema.shape)[0]).toBe('description')
  })
})
