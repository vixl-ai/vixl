import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { effectScope } from 'vue'
import { toast } from 'vue-sonner'
import { vixlFileChangeToken } from '@/composables/use-vixl-live-sync'
import useSlashIndex, {
  resetSlashIndexToastsForTests,
} from '@/composables/use-slash-index'

const listSlashSkillIndex = vi.hoisted(() =>
  vi.fn<(root: string | null) => Promise<unknown[]>>(async () => []),
)
const listAgentIndex = vi.hoisted(() =>
  vi.fn<(root: string | null) => Promise<unknown[]>>(async () => []),
)
const isDisconnectedRoot = vi.hoisted(() =>
  vi.fn<(root: string | null | undefined) => boolean>(() => true),
)

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/services/skills/skill-registry', () => ({
  listSlashSkillIndex: (root: string | null) => listSlashSkillIndex(root),
}))

vi.mock('@/services/agents/registry', () => ({
  listAgentIndex: (root: string | null) => listAgentIndex(root),
}))

vi.mock('@/composables/ssh-session/fleet', () => ({
  isDisconnectedRoot: (root: string | null | undefined) => isDisconnectedRoot(root),
}))

const sshRoot = 'ssh://aidanhibbard@eva.local/home/aidanhibbard/proj'
const otherRoot = 'ssh://aidanhibbard@other.local/home/aidanhibbard/proj'
const offline = new Error(
  'eva.local is unreachable. eva.local is not connected. The SSH master is dead. This channel was not opened.',
)
const reconnect = {
  id: `slash-offline:${sshRoot}`,
  description: 'Right click the project and click reconnect',
}

describe('useSlashIndex offline ssh', () => {
  beforeEach(() => {
    resetSlashIndexToastsForTests()
    vi.mocked(toast.error).mockClear()
    isDisconnectedRoot.mockReset()
    isDisconnectedRoot.mockReturnValue(true)
    listSlashSkillIndex.mockReset()
    listAgentIndex.mockReset()
    listSlashSkillIndex.mockRejectedValue(offline)
    listAgentIndex.mockRejectedValue(offline)
  })

  it('stays quiet while a disconnected project loads chats', async () => {
    const first = effectScope()
    const second = effectScope()
    const firstApi = first.run(() => useSlashIndex(() => sshRoot))
    second.run(() => {
      useSlashIndex(() => sshRoot)
    })
    await flushPromises()
    await firstApi?.refresh()
    vixlFileChangeToken.value += 1
    await flushPromises()

    expect(toast.error).not.toHaveBeenCalled()
    first.stop()
    second.stop()
  })

  it('announces a connected project once when the load fails', async () => {
    isDisconnectedRoot.mockReturnValue(false)
    const first = effectScope()
    const second = effectScope()
    first.run(() => {
      useSlashIndex(() => sshRoot)
    })
    second.run(() => {
      useSlashIndex(() => sshRoot)
    })
    await flushPromises()
    vixlFileChangeToken.value += 1
    await flushPromises()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Failed to load skills', reconnect)
    first.stop()
    second.stop()
  })

  it('announces again after the project loads, and separately for another project', async () => {
    isDisconnectedRoot.mockReturnValue(false)
    const scope = effectScope()
    let root = sshRoot
    const api = scope.run(() => useSlashIndex(() => root))
    await flushPromises()

    await api?.refresh()
    listSlashSkillIndex.mockResolvedValue([])
    listAgentIndex.mockResolvedValue([])
    await api?.refresh()
    listSlashSkillIndex.mockRejectedValue(offline)
    listAgentIndex.mockResolvedValue([])
    await api?.refresh()

    root = otherRoot
    listSlashSkillIndex.mockResolvedValue([])
    listAgentIndex.mockRejectedValue(offline)
    await api?.refresh()

    expect(toast.error).toHaveBeenCalledTimes(3)
    expect(toast.error).toHaveBeenNthCalledWith(1, 'Failed to load skills', reconnect)
    expect(toast.error).toHaveBeenNthCalledWith(2, 'Failed to load skills', reconnect)
    expect(toast.error).toHaveBeenNthCalledWith(3, 'Failed to load agents', {
      id: `slash-offline:${otherRoot}`,
      description: 'Right click the project and click reconnect',
    })
    scope.stop()
  })

  it('still reports a local load failure at startup', async () => {
    listSlashSkillIndex.mockRejectedValue(new Error('disk full'))
    listAgentIndex.mockResolvedValue([])
    const scope = effectScope()
    scope.run(() => {
      useSlashIndex(() => '/tmp/proj')
    })
    await flushPromises()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Failed to load skills', {
      description: 'disk full',
    })
    scope.stop()
  })
})
