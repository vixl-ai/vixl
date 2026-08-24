import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HarnessEvent } from '@/types/harness/harness-event'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import { mockTauriEvent } from '../../test-utils/mocks/tauri-event'

const shellSpawnTracked = vi.fn<() => Promise<void>>()
const shellKillTracked = vi.fn<() => Promise<{ exitCode: number; signal?: number }>>()

vi.mock('@tauri-apps/api/event', () => mockTauriEvent())

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    shellSpawnTracked,
    shellKillTracked,
  }),
)

describe('agent shell event emitters per chat', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    shellSpawnTracked.mockResolvedValue(undefined)
    shellKillTracked.mockResolvedValue({ exitCode: 0 })
    const { resetAgentShellRegistryForTests } = await import(
      '@/services/harness/shell/registry'
    )
    resetAgentShellRegistryForTests()
  })

  it('routes shell events only to the owning chat emitter', async () => {
    const {
      createAgentShell,
      setAgentShellEventEmitter,
      resetAgentShellRegistryForTests,
    } = await import('@/services/harness/shell/registry')
    resetAgentShellRegistryForTests()

    const eventsA: HarnessEvent[] = []
    const eventsB: HarnessEvent[] = []
    setAgentShellEventEmitter('chat-a', (event) => {
      eventsA.push(event)
    })
    setAgentShellEventEmitter('chat-b', (event) => {
      eventsB.push(event)
    })

    const shellA = await createAgentShell({
      chatId: 'chat-a',
      projectRoot: '/project',
      command: 'echo a',
    })

    const { listen } = await import('@tauri-apps/api/event')
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>
    const outputHandler = listenMock.mock.calls.find(
      (call) => call[0] === `shell-output-${shellA.shellId}`,
    )?.[1] as ((event: { payload: { stream: 'stdout' | 'stderr'; data: string } }) => void) | undefined

    expect(outputHandler).toBeTypeOf('function')
    outputHandler?.({ payload: { stream: 'stdout', data: 'from-a' } })

    expect(eventsA.some((event) => event.type === 'terminal-output')).toBe(true)
    expect(eventsB).toHaveLength(0)
  })

  it('does not throw or invoke another chat emitter for an unknown chatId', async () => {
    const { createAgentShell, setAgentShellEventEmitter } = await import(
      '@/services/harness/shell/registry'
    )

    const eventsA: HarnessEvent[] = []
    setAgentShellEventEmitter('chat-a', (event) => {
      eventsA.push(event)
    })

    const unknownShell = await createAgentShell({
      chatId: 'chat-unknown',
      projectRoot: '/project',
      command: 'echo unknown',
    })

    const { listen } = await import('@tauri-apps/api/event')
    const listenMock = listen as unknown as ReturnType<typeof vi.fn>
    const outputHandler = listenMock.mock.calls.find(
      (call) => call[0] === `shell-output-${unknownShell.shellId}`,
    )?.[1] as ((event: { payload: { stream: 'stdout' | 'stderr'; data: string } }) => void) | undefined

    expect(outputHandler).toBeTypeOf('function')
    expect(() => {
      outputHandler?.({ payload: { stream: 'stdout', data: 'from-unknown' } })
    }).not.toThrow()
    expect(eventsA).toHaveLength(0)
  })
})
