import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const workspaceGrep = vi.hoisted(() =>
  vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(async () => ({
    matches: [],
  })),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    workspaceGrep: (args: Record<string, unknown>) => workspaceGrep(args),
  }),
)

import grep from '@/services/harness/read/grep'

const api: HarnessWorkspaceMember = {
  slug: 'api',
  name: 'API',
  rootPath: '/tmp/api',
}
const web: HarnessWorkspaceMember = {
  slug: 'web',
  name: 'Web',
  rootPath: '/tmp/web',
}

const baseCtx = (overrides?: Partial<HarnessToolContext>): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
  ...overrides,
})

const execute = async (
  input: Record<string, unknown>,
  ctx: HarnessToolContext = baseCtx(),
): Promise<unknown> => {
  const built = grep(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('grep projectRoots', () => {
  beforeEach(() => {
    workspaceGrep.mockReset()
    workspaceGrep.mockResolvedValue({ matches: [] })
  })

  it('passes projectRoots to IPC when members exist', async () => {
    await execute(
      { pattern: 'TODO', glob: '*.ts' },
      baseCtx({
        projectRoot: '/tmp/api',
        projectSlug: 'stack',
        members: [api, web],
      }),
    )

    expect(workspaceGrep).toHaveBeenCalledWith({
      projectRoot: '/tmp/api',
      pattern: 'TODO',
      glob: '*.ts',
      projectRoots: [
        { slug: 'api', path: '/tmp/api' },
        { slug: 'web', path: '/tmp/web' },
      ],
    })
  })

  it('omits projectRoots for a single-project chat', async () => {
    await execute({ pattern: 'TODO' }, baseCtx())

    expect(workspaceGrep).toHaveBeenCalledWith({
      projectRoot: '/tmp/project',
      pattern: 'TODO',
      glob: undefined,
    })
    expect(workspaceGrep.mock.calls[0]?.[0]).not.toHaveProperty('projectRoots')
  })
})
