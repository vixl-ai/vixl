import { describe, expect, it } from 'vitest'
import { toPersistedSession } from '@/composables/workbench-store/persist'
import type { WorkbenchTab } from '@/types/workbench/workbench-tab'

describe('toPersistedSession', () => {
  it('omits dirty and nulls terminal sessionId', () => {
    const tabs: WorkbenchTab[] = [
      {
        id: 'e1',
        type: 'editor',
        projectId: 'p1',
        label: 'main.ts',
        dirty: true,
        payload: { path: 'src/main.ts', openPaths: ['src/main.ts'] },
      },
      {
        id: 't1',
        type: 'terminal',
        projectId: 'p1',
        label: 'Terminal',
        payload: { sessionId: 'pty-1', cwd: '/tmp/p1' },
      },
    ]

    const session = toPersistedSession(tabs, 't1', true)

    expect(session.activeTabId).toBe('t1')
    expect(session.rightSidebarOpen).toBe(true)
    expect(session.tabs[0]).toEqual({
      id: 'e1',
      type: 'editor',
      projectId: 'p1',
      label: 'main.ts',
      payload: { path: 'src/main.ts', openPaths: ['src/main.ts'] },
    })
    expect(session.tabs[0]).not.toHaveProperty('dirty')
    expect(session.tabs[1]?.payload).toEqual({
      sessionId: null,
      cwd: '/tmp/p1',
    })
  })
})
