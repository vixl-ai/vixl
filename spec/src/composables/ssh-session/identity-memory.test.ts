import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FleetProject } from '@/types/fleet/fleet-project'

vi.mock('@/composables/use-fleet-sidebar', () => ({
  refreshFleetSidebar: vi.fn<() => Promise<void>>(async () => undefined),
}))

vi.mock('@/services/vixl/vixl-tauri/ssh', () => ({
  sshCancelConnect: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  sshCancelPrompt: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  sshAnswerConfirm: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  sshConnect: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
  sshPreview: vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({})),
}))

vi.mock('@/composables/ssh-session/events', () => ({
  loadAliases: vi.fn<() => Promise<void>>(async () => undefined),
}))

vi.mock('@/composables/ssh-session/folder', () => ({
  startFolderPicker: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
}))

const project = (rootPath: string): FleetProject => ({
  id: 'p1',
  name: 'garden',
  slug: 'garden',
  rootPath,
  lastOpened: '2026-11-02T00:00:00.000Z',
})

const memoryStore = new Map<string, string>()

const installIdentityStorage = (): void => {
  memoryStore.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memoryStore.set(key, value)
    },
    removeItem: (key: string) => {
      memoryStore.delete(key)
    },
    clear: () => {
      memoryStore.clear()
    },
  })
}

describe('ssh identity memory', () => {
  beforeEach(() => {
    installIdentityStorage()
  })

  it('prefills the identity file on reconnect for that account', async () => {
    const { fillFromProject } = await import('@/composables/ssh-session/connect')
    const { rememberSshIdentity } = await import('@/composables/ssh-session/identity-memory')
    const state = await import('@/composables/ssh-session/state')

    rememberSshIdentity('johnny', 'appleseed.example', 22, '/Users/johnny/.ssh/id_ed25519')
    state.resetConnectForm()
    fillFromProject(project('ssh://johnny@appleseed.example/home/johnny/garden'))

    expect(state.connectUser.value).toBe('johnny')
    expect(state.connectHost.value).toBe('appleseed.example')
    expect(state.connectPort.value).toBe('22')
    expect(state.connectIdentity.value).toBe('/Users/johnny/.ssh/id_ed25519')
  })

  it('remembers the identity typed on connect', async () => {
    const ssh = await import('@/services/vixl/vixl-tauri/ssh')
    vi.mocked(ssh.sshPreview).mockResolvedValue({
      destination: 'johnny@appleseed.example',
      user: 'johnny',
      hostname: 'appleseed.example',
      port: 22,
      identityFiles: ['/Users/johnny/.ssh/id_ed25519'],
      identitiesOnly: true,
      sawMatch: true,
      confirmBody: '',
    })
    vi.mocked(ssh.sshConnect).mockResolvedValue({
      user: 'johnny',
      hostname: 'appleseed.example',
      port: 22,
      destination: 'johnny@appleseed.example',
      state: 'connected',
      line: 'Connected.',
      lastError: null,
      masterAlive: true,
    })
    const { fillFromProject, submitConnectForm } = await import('@/composables/ssh-session/connect')
    const state = await import('@/composables/ssh-session/state')
    state.resetConnectForm()
    state.connectMode.value = 'reconnect'
    state.connectHost.value = 'appleseed.example'
    state.connectUser.value = 'johnny'
    state.connectPort.value = '22'
    state.connectIdentity.value = '/Users/johnny/.ssh/id_ed25519'

    await submitConnectForm()
    fillFromProject(project('ssh://johnny@appleseed.example/home/johnny/garden'))

    expect(state.connectIdentity.value).toBe('/Users/johnny/.ssh/id_ed25519')
  })

  it('keeps a different port and a cleared identity apart', async () => {
    const { rememberSshIdentity, rememberedSshIdentity } = await import(
      '@/composables/ssh-session/identity-memory'
    )

    rememberSshIdentity('johnny', 'Appleseed.Example', 2222, '/home/johnny/.ssh/id_ed25519')
    rememberSshIdentity('johnny', 'appleseed.example', 22, '/Users/johnny/.ssh/id_ed25519')
    rememberSshIdentity('johnny', 'appleseed.example', 22, '')

    expect(rememberedSshIdentity('johnny', 'appleseed.example', 2222)).toBe(
      '/home/johnny/.ssh/id_ed25519',
    )
    expect(rememberedSshIdentity('johnny', 'appleseed.example', 22)).toBe('')
  })
})
