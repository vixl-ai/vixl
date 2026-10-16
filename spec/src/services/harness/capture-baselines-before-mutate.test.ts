import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

const fileCheckpointCapture = vi.hoisted(() =>
  vi.fn<
    (args: {
      projectSlug: string
      chatId: string
      userMessageId: string
      projectRoot: string
      path: string
      key?: string
      toolCallId?: string
    }) => Promise<void>
  >(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fileCheckpointCapture: (
      args: {
        projectSlug: string
        chatId: string
        userMessageId: string
        projectRoot: string
        path: string
        key?: string
        toolCallId?: string
      },
    ) => fileCheckpointCapture(args),
  }),
)

import captureBaselinesBeforeMutate from '@/services/harness/capture-baselines-before-mutate'

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

describe('captureBaselinesBeforeMutate', () => {
  beforeEach(() => {
    fileCheckpointCapture.mockReset()
    fileCheckpointCapture.mockResolvedValue(undefined)
  })

  it('omits key for a single-project path', async () => {
    await captureBaselinesBeforeMutate(
      {
        projectRoot: '/tmp/project',
        projectSlug: 'project',
        chatId: 'chat-1',
        userMessageId: 'u1',
      },
      ['src/a.ts'],
      'tc-1',
    )

    expect(fileCheckpointCapture).toHaveBeenCalledWith({
      projectSlug: 'project',
      chatId: 'chat-1',
      userMessageId: 'u1',
      projectRoot: '/tmp/project',
      path: 'src/a.ts',
      toolCallId: 'tc-1',
    })
  })

  it('sends a slug-prefixed key when two members share a relative path', async () => {
    await captureBaselinesBeforeMutate(
      {
        projectRoot: '/tmp/api',
        projectSlug: 'stack',
        chatId: 'chat-1',
        userMessageId: 'u1',
        members: [api, web],
      },
      ['api/src/a.ts', 'web/src/a.ts'],
    )

    expect(fileCheckpointCapture).toHaveBeenNthCalledWith(1, {
      projectSlug: 'stack',
      chatId: 'chat-1',
      userMessageId: 'u1',
      projectRoot: '/tmp/api',
      path: 'src/a.ts',
      key: 'api/src/a.ts',
      toolCallId: undefined,
    })
    expect(fileCheckpointCapture).toHaveBeenNthCalledWith(2, {
      projectSlug: 'stack',
      chatId: 'chat-1',
      userMessageId: 'u1',
      projectRoot: '/tmp/web',
      path: 'src/a.ts',
      key: 'web/src/a.ts',
      toolCallId: undefined,
    })
  })
})
