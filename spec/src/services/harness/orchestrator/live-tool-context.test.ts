import { describe, expect, it, vi } from 'vitest'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspace } from '@/types/harness/harness-workspace'
import bindLiveToolContext from '@/services/harness/orchestrator/live-tool-context'

const rest = (): Omit<HarnessToolContext, 'projectRoot' | 'projectSlug' | 'members'> => ({
  chatId: 'chat-1',
  mode: 'agent',
  settings: {} as HarnessToolContext['settings'],
  permissionLevel: 'allowlist',
  sessionAllows: new Set<string>(),
  sessionDenies: new Set<string>(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: vi.fn<() => void>(),
})

describe('bindLiveToolContext', () => {
  it('reads and writes members on the shared workspace object', () => {
    const workspace: HarnessWorkspace = {
      projectSlug: 'stack',
      projectRoot: '/tmp/api',
      projectName: 'Stack',
    }
    const ctx = bindLiveToolContext(workspace, rest())
    expect(ctx.members).toBeUndefined()

    const members = [
      { slug: 'api', name: 'API', rootPath: '/tmp/api' },
      { slug: 'web', name: 'Web', rootPath: '/tmp/web' },
    ]
    ctx.members = members
    expect(workspace.members).toBe(members)
    expect(ctx.members).toBe(members)

    workspace.members = [members[0]!]
    expect(ctx.members).toEqual([members[0]])
  })
})
