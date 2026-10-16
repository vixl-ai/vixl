import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const { fsReadFile, fsWriteFile } = vi.hoisted(() => ({
  fsReadFile: vi.fn<
    (args: { projectRoot: string; path: string }) => Promise<{ content: string }>
  >(),
  fsWriteFile: vi.fn<
    (args: { projectRoot: string; path: string; content: string }) => Promise<unknown>
  >(),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsReadFile,
    fsWriteFile,
  }),
)

import clearStaleChatRefs from '@/services/plans/clear-stale-chat-refs'

const PLAN_PATH = '.vixl/plans/example/PLAN.md'
const PROJECT_ROOT = '/repo'

const validPlan = `---
id: example-plan
title: Example
createdAt: 2026-09-09T18:00:00.000Z
mode: plan
sourceChatId: keep-chat
sourceChatSlug: group
lastBuildChatId: stale-chat
lastBuildChatSlug: stack
builtAt: 2026-09-09T18:00:00.000Z
lastBuildModel: gpt-4
todos:
  - id: t1
    content: "Do it"
    status: pending
---

## Goal

Ship it.
`

describe('clear-stale-chat-refs', () => {
  beforeEach(() => {
    fsReadFile.mockReset()
    fsWriteFile.mockReset()
    fsWriteFile.mockResolvedValue(undefined)
    fsReadFile.mockResolvedValue({ content: validPlan })
  })

  it('removes only stale sourceChatId and lastBuildChatId lines', async () => {
    await clearStaleChatRefs({
      projectRoot: PROJECT_ROOT,
      path: PLAN_PATH,
      staleChatIds: ['stale-chat'],
    })

    expect(fsWriteFile).toHaveBeenCalledTimes(1)
    const written = fsWriteFile.mock.calls[0]?.[0].content ?? ''
    expect(written).toContain('sourceChatId: keep-chat')
    expect(written).toContain('sourceChatSlug: group')
    expect(written).not.toContain('lastBuildChatId:')
    expect(written).not.toContain('lastBuildChatSlug:')
    expect(written).toContain('builtAt: 2026-09-09T18:00:00.000Z')
    expect(written).toContain('lastBuildModel: gpt-4')
    expect(written).toContain('## Goal')
    expect(written).toContain('Ship it.')
    expect(written).toContain('id: example-plan')
  })

  it('removes only stale sourceChatId and keeps a valid lastBuildChatId', async () => {
    await clearStaleChatRefs({
      projectRoot: PROJECT_ROOT,
      path: PLAN_PATH,
      staleChatIds: ['keep-chat'],
    })

    expect(fsWriteFile).toHaveBeenCalledTimes(1)
    const written = fsWriteFile.mock.calls[0]?.[0].content ?? ''
    expect(written).not.toContain('sourceChatId:')
    expect(written).not.toContain('sourceChatSlug:')
    expect(written).toContain('lastBuildChatId: stale-chat')
    expect(written).toContain('lastBuildChatSlug: stack')
  })

  it('keeps sourceChatSlug when only lastBuildChatId is stale', async () => {
    await clearStaleChatRefs({
      projectRoot: PROJECT_ROOT,
      path: PLAN_PATH,
      staleChatIds: ['stale-chat'],
    })

    const written = fsWriteFile.mock.calls[0]?.[0].content ?? ''
    expect(written).toContain('sourceChatSlug: group')
    expect(written).not.toContain('lastBuildChatSlug:')
  })

  it('keeps valid sourceChatId and lastBuildChatId when they are not stale', async () => {
    await clearStaleChatRefs({
      projectRoot: PROJECT_ROOT,
      path: PLAN_PATH,
      staleChatIds: ['other-chat'],
    })

    expect(fsWriteFile).not.toHaveBeenCalled()
  })

  it('does not write when nothing is stale', async () => {
    await clearStaleChatRefs({
      projectRoot: PROJECT_ROOT,
      path: PLAN_PATH,
      staleChatIds: [],
    })

    expect(fsReadFile).not.toHaveBeenCalled()
    expect(fsWriteFile).not.toHaveBeenCalled()
  })

  it('throws on invalid output without writing', async () => {
    fsReadFile.mockResolvedValue({
      content: `---
id: broken
title: Broken
createdAt: 2026-09-09T18:00:00.000Z
sourceChatId: gone
---

Body
`,
    })

    await expect(
      clearStaleChatRefs({
        projectRoot: PROJECT_ROOT,
        path: PLAN_PATH,
        staleChatIds: ['gone'],
      }),
    ).rejects.toThrow(/Invalid plan frontmatter/)
    expect(fsWriteFile).not.toHaveBeenCalled()
  })
})
