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

import updatePlanFrontmatter from '@/services/plans/update-plan-frontmatter'

const PLAN_PATH = '.vixl/plans/example/PLAN.md'
const PROJECT_ROOT = '/repo'

const basePlan = `---
id: example-plan
title: Example
createdAt: 2026-09-09T18:00:00.000Z
mode: plan
todos: []
---

## Goal

Ship it.
`

describe('update-plan-frontmatter', () => {
  beforeEach(() => {
    fsReadFile.mockReset()
    fsWriteFile.mockReset()
    fsWriteFile.mockResolvedValue(undefined)
    fsReadFile.mockResolvedValue({ content: basePlan })
  })

  it('writes lastBuildChatSlug as a plain unquoted string', async () => {
    await updatePlanFrontmatter({
      projectRoot: PROJECT_ROOT,
      path: PLAN_PATH,
      patch: {
        builtAt: '2026-09-09T19:00:00.000Z',
        lastBuildChatId: 'chat-1',
        lastBuildChatSlug: 'stack',
        lastBuildModel: 'gpt-4',
      },
    })

    const written = fsWriteFile.mock.calls[0]?.[0].content ?? ''
    expect(written).toContain('lastBuildChatId: chat-1')
    expect(written).toContain('lastBuildChatSlug: stack')
    expect(written).not.toContain('lastBuildChatSlug: "stack"')
    expect(written).toContain('lastBuildModel: "gpt-4"')
    expect(written).toContain('builtAt: 2026-09-09T19:00:00.000Z')
  })

  it('removes lastBuildChatSlug when the patch value is null', async () => {
    fsReadFile.mockResolvedValue({
      content: `---
id: example-plan
title: Example
createdAt: 2026-09-09T18:00:00.000Z
mode: plan
lastBuildChatId: chat-1
lastBuildChatSlug: stack
builtAt: 2026-09-09T19:00:00.000Z
lastBuildModel: gpt-4
todos: []
---

## Goal

Ship it.
`,
    })

    await updatePlanFrontmatter({
      projectRoot: PROJECT_ROOT,
      path: PLAN_PATH,
      patch: {
        lastBuildChatId: null,
        lastBuildChatSlug: null,
        builtAt: null,
      },
    })

    const written = fsWriteFile.mock.calls[0]?.[0].content ?? ''
    expect(written).not.toContain('lastBuildChatId:')
    expect(written).not.toContain('lastBuildChatSlug:')
    expect(written).not.toContain('builtAt:')
    expect(written).toContain('lastBuildModel: gpt-4')
  })
})
