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

const sshRoot = 'ssh://aidanhibbard@eva.local/home/aidanhibbard/proj'
const otherRoot = 'ssh://aidanhibbard@other.local/home/aidanhibbard/proj'
const offline = new Error(
  'eva.local is unreachable. eva.local is not connected. The SSH master is dead. This channel was not opened.',
)
const reconnect = {
  description: 'Right click the project and click reconnect',
}

describe('useSlashIndex offline ssh', () => {
  beforeEach(() => {
    resetSlashIndexToastsForTests()
    vi.mocked(toast.error).mockClear()
    listSlashSkillIndex.mockReset()
    listAgentIndex.mockReset()
    listSlashSkillIndex.mockRejectedValue(offline)
    listAgentIndex.mockRejectedValue(offline)
  })

  it('stays quiet when chats load a disconnected project at startup', async () => {
    const first = effectScope()
    const second = effectScope()
    first.run(() => {
      useSlashIndex(() => sshRoot)
    })
    second.run(() => {
      useSlashIndex(() => sshRoot)
    })
    await flushPromises()

    expect(toast.error).not.toHaveBeenCalled()
    first.stop()
    second.stop()
  })

  it('announces a later failure once per project', async () => {
    const first = effectScope()
    const second = effectScope()
    let refresh: (() => Promise<void>) | null = null
    first.run(() => {
      refresh = useSlashIndex(() => sshRoot).refresh
    })
    second.run(() => {
      useSlashIndex(() => sshRoot)
    })
    await flushPromises()

    await refresh?.()
    await flushPromises()
    vixlFileChangeToken.value += 1
    await flushPromises()

    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error).toHaveBeenCalledWith('Failed to load skills', reconnect)
    first.stop()
    second.stop()
  })

  it('announces again after the project loads, and separately for another project', async () => {
    const scope = effectScope()
    let refresh: (() => Promise<void>) | null = null
    let root = sshRoot
    scope.run(() => {
      refresh = useSlashIndex(() => root).refresh
    })
    await flushPromises()

    await refresh?.()
    listSlashSkillIndex.mockResolvedValue([])
    listAgentIndex.mockResolvedValue([])
    await refresh?.()
    listSlashSkillIndex.mockRejectedValue(offline)
    listAgentIndex.mockResolvedValue([])
    await refresh?.()

    root = otherRoot
    listSlashSkillIndex.mockResolvedValue([])
    listAgentIndex.mockRejectedValue(offline)
    await refresh?.()

    expect(toast.error).toHaveBeenCalledTimes(3)
    expect(toast.error).toHaveBeenNthCalledWith(1, 'Failed to load skills', reconnect)
    expect(toast.error).toHaveBeenNthCalledWith(2, 'Failed to load skills', reconnect)
    expect(toast.error).toHaveBeenNthCalledWith(3, 'Failed to load agents', reconnect)
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
