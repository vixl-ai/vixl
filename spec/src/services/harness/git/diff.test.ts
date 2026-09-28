import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const gitDiffCommand = vi.hoisted(() =>
  vi.fn<
    (args: {
      projectRoot: string
      path?: string
      staged?: boolean
      base?: string
    }) => Promise<{ diff: string }>
  >(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    gitDiff: (args: {
      projectRoot: string
      path?: string
      staged?: boolean
      base?: string
    }) => gitDiffCommand(args),
  }),
)

import gitDiff from '@/services/harness/git/diff'

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
  const built = gitDiff(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('git_diff tool', () => {
  beforeEach(() => {
    gitDiffCommand.mockReset()
    gitDiffCommand.mockResolvedValue({ diff: '' })
  })

  it('passes projectRoot, path, staged, and base through', async () => {
    await execute({
      path: 'src/a.ts',
      staged: true,
      base: 'HEAD',
    })

    expect(gitDiffCommand).toHaveBeenCalledWith({
      projectRoot: '/tmp/project',
      path: 'src/a.ts',
      staged: true,
      base: 'HEAD',
    })
  })

  it('omits path, staged, and base when not provided', async () => {
    await execute({})

    expect(gitDiffCommand).toHaveBeenCalledWith({
      projectRoot: '/tmp/project',
      path: undefined,
      staged: undefined,
      base: undefined,
    })
  })
})
