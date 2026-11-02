import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { toast } from 'vue-sonner'
import { confirmDisconnect, requestDisconnect } from '@/composables/ssh-session/fleet'
import { handleSshError } from '@/composables/ssh-session/events'
import * as state from '@/composables/ssh-session/state'
import type { FleetProject } from '@/types/fleet/fleet-project'

const sshDisconnect = vi.hoisted(() =>
  vi.fn<(user: string, hostname: string, port: number) => Promise<unknown>>(),
)
const registryProjects = vi.hoisted(() => ({
  value: [] as FleetProject[],
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>(),
  Channel: vi.fn<() => unknown>(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn<(event: string, handler: unknown) => Promise<() => void>>(async () => () => {}),
}))

vi.mock('@/services/vixl/vixl-tauri/ssh', () => ({
  sshDisconnect,
  sshOpenLocalForward: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  sshListAliases: vi.fn<() => Promise<unknown[]>>(async () => []),
  sshListSessions: vi.fn<() => Promise<unknown[]>>(async () => []),
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    projects: registryProjects,
  }),
}))

const project: FleetProject = {
  id: 'p1',
  name: 'proj',
  slug: 'proj',
  rootPath: 'ssh://aidanhibbard@eva.local/home/aidanhibbard/proj',
  lastOpened: '2026-11-02T00:00:00.000Z',
}

const otherProject: FleetProject = {
  ...project,
  id: 'p2',
  name: 'other',
  slug: 'other',
  rootPath: 'ssh://aidanhibbard@eva.local/home/aidanhibbard/other',
}

const commandStatus = {
  user: 'aidanhibbard',
  hostname: 'eva.local',
  port: 22,
  destination: 'aidanhibbard@eva.local',
  state: 'disconnected',
  line: 'Could not connect to eva.local.',
  lastError: {
    title: 'Could not connect to eva.local.',
    body: '',
  },
  masterAlive: false,
}

const connectFailure = {
  hostname: 'eva.local',
  port: 22,
  title: 'Could not connect to eva.local.',
  body: '',
}

describe('ssh disconnect', () => {
  beforeEach(() => {
    registryProjects.value = [project]
    sshDisconnect.mockReset()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    state.sessions.value = []
    state.disconnectConfirm.value = null
    state.connectOpen.value = false
    state.confirmEvent.value = null
    state.secretEvent.value = null
    state.changedKey.value = null
    state.activePreview.value = null
    state.connectUser.value = ''
    state.toastedDeath.clear()
    state.clearUserDisconnect('aidanhibbard', 'eva.local', 22)
  })

  it('confirms a disconnect with a success toast', async () => {
    sshDisconnect.mockImplementation(async () => {
      handleSshError(connectFailure)
      return commandStatus
    })

    requestDisconnect(project)
    await flushPromises()

    expect(toast.success).toHaveBeenCalledWith('eva.local disconnected.')
    expect(toast.error).not.toHaveBeenCalled()
    expect(state.sessions.value).toEqual([
      expect.objectContaining({
        hostname: 'eva.local',
        state: 'disconnected',
        masterAlive: false,
        lastError: null,
        line: 'Disconnected from eva.local.',
      }),
    ])
  })

  it('reports a disconnect that did not exit', async () => {
    sshDisconnect.mockRejectedValue(new Error('exit failed'))

    requestDisconnect(project)
    await flushPromises()

    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('The connection to eva.local did not exit.', {
      description: 'exit failed',
    })
    handleSshError(connectFailure)
    expect(toast.error).toHaveBeenCalledWith('eva.local disconnected.', {
      description: 'Could not connect to eva.local.',
    })
  })

  it('still reports an unexpected disconnect', () => {
    handleSshError(connectFailure)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('eva.local disconnected.', {
      description: 'Could not connect to eva.local.',
    })
  })

  it('waits for the shared-host confirm before the success toast', async () => {
    registryProjects.value = [project, otherProject]
    sshDisconnect.mockResolvedValue(commandStatus)

    requestDisconnect(project)
    await flushPromises()

    expect(sshDisconnect).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(state.disconnectConfirm.value).toEqual({
      user: 'aidanhibbard',
      hostname: 'eva.local',
      port: 22,
      sharedCount: 2,
    })

    await confirmDisconnect()

    expect(toast.success).toHaveBeenCalledWith('eva.local disconnected.')
    expect(toast.error).not.toHaveBeenCalled()
  })
})
