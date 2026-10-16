import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { toast } from 'vue-sonner'
import ChatTurnFilesChanged from '@/components/chat/ChatTurnFilesChanged.vue'
import type { AggregatedTurnFileChange } from '@/types/harness/file-checkpoint'
import openAtLine from '@/utils/open-at-line'

const routeState = vi.hoisted(() => ({
  name: 'project-chat' as string,
  params: { slug: 'proj' } as Record<string, string>,
}))

const fleetState = vi.hoisted(() => ({
  projects: [{ id: 'proj-1', slug: 'proj', name: 'Proj', rootPath: '/tmp/proj' }],
  groups: [] as Array<{
    id: string
    name: string
    slug: string
    memberSlugs: string[]
    lastOpened: string
  }>,
  activeProjectId: 'proj-1',
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
}))

vi.mock('@/composables/use-fleet-registry', () => ({
  default: () => ({
    projects: {
      get value() {
        return fleetState.projects
      },
    },
    groups: {
      get value() {
        return fleetState.groups
      },
    },
    activeProjectId: {
      get value() {
        return fleetState.activeProjectId
      },
    },
  }),
}))

vi.mock('@/utils/open-at-line', () => ({
  default: vi.fn<(...args: unknown[]) => Promise<void>>(),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const passThrough = { template: '<div><slot /></div>' }

const stubs = {
  AlertDialog: passThrough,
  AlertDialogContent: passThrough,
  AlertDialogHeader: passThrough,
  AlertDialogTitle: passThrough,
  AlertDialogDescription: passThrough,
  AlertDialogFooter: passThrough,
  AlertDialogCancel: { template: '<button><slot /></button>' },
  Tooltip: passThrough,
  TooltipTrigger: passThrough,
  TooltipContent: true,
  Collapsible: passThrough,
  CollapsibleTrigger: { template: '<button><slot /></button>' },
  CollapsibleContent: passThrough,
  CommitFiles: passThrough,
  CommitFile: passThrough,
  CommitFileStatus: true,
  CommitFilePath: { template: '<span><slot /></span>' },
  CommitFileAdditions: true,
  CommitFileDeletions: true,
}

const cumulativeChanges: AggregatedTurnFileChange[] = [
  { path: 'a.ts', operation: 'update', additions: 2, deletions: 1 },
  { path: 'b.ts', operation: 'create', additions: 3, deletions: 0 },
]

const perTurnChanges: AggregatedTurnFileChange[] = [
  { path: 'a.ts', operation: 'update', additions: 2, deletions: 1 },
]

const clarification =
  'Only files changed since that message are reverted. Earlier changes listed above are kept.'

const latestMessageWarning = 'Your latest message will also be discarded.'

let wrapper: VueWrapper | null = null

const mountBlock = (props: {
  changes?: AggregatedTurnFileChange[]
  restoreChanges?: AggregatedTurnFileChange[]
  restoreEnabled?: boolean
  restoreDiscardsLatestMessage?: boolean
}): VueWrapper => {
  wrapper = mount(ChatTurnFilesChanged, {
    props: {
      changes: props.changes ?? cumulativeChanges,
      restoreChanges: props.restoreChanges,
      restoreEnabled: props.restoreEnabled ?? true,
      restoreDiscardsLatestMessage: props.restoreDiscardsLatestMessage,
    },
    global: { stubs },
  })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('ChatTurnFilesChanged restore dialog copy', () => {
  it('clarifies that only files since the prompting message are reverted when restoreChanges is narrower', () => {
    const mounted = mountBlock({ restoreChanges: perTurnChanges })
    expect(mounted.text()).toContain('Revert files from this turn?')
    expect(mounted.text()).toContain(clarification)
    expect(mounted.text()).toContain('This will revert 1 file')
    expect(mounted.text()).toContain(
      'to the state before the message that prompted this turn',
    )
    expect(mounted.text()).toContain(
      'and discard the conversation after that message.',
    )
    expect(mounted.text()).toContain(
      'Manual edits on those paths will also be overwritten.',
    )
    expect(mounted.text()).not.toContain(latestMessageWarning)
  })

  it('keeps the original copy when restoreChanges is omitted', () => {
    const mounted = mountBlock({})
    expect(mounted.text()).toContain('Revert files from this turn?')
    expect(mounted.text()).not.toContain(clarification)
    expect(mounted.text()).toContain('This will revert 2 files')
    expect(mounted.text()).toContain(
      'to the state before the message that prompted this turn',
    )
    expect(mounted.text()).toContain('(1 created file removed)')
    expect(mounted.text()).toContain(
      'and discard the conversation after that message.',
    )
    expect(mounted.text()).toContain(
      'Manual edits on those paths will also be overwritten.',
    )
    expect(mounted.text()).not.toContain(latestMessageWarning)
  })

  it('keeps the original copy when restoreChanges covers the same paths', () => {
    const mounted = mountBlock({ restoreChanges: cumulativeChanges })
    expect(mounted.text()).toContain('Revert files from this turn?')
    expect(mounted.text()).not.toContain(clarification)
    expect(mounted.text()).toContain('This will revert 2 files')
    expect(mounted.text()).toContain(
      'to the state before the message that prompted this turn',
    )
    expect(mounted.text()).toContain('(1 created file removed)')
    expect(mounted.text()).toContain(
      'and discard the conversation after that message.',
    )
    expect(mounted.text()).toContain(
      'Manual edits on those paths will also be overwritten.',
    )
    expect(mounted.text()).not.toContain(latestMessageWarning)
  })

  it('warns that the latest message is discarded when restoreDiscardsLatestMessage is true', () => {
    const mounted = mountBlock({ restoreDiscardsLatestMessage: true })
    expect(mounted.text()).toContain(latestMessageWarning)
  })

  it('omits the latest-message warning when restoreDiscardsLatestMessage is false', () => {
    const mounted = mountBlock({ restoreDiscardsLatestMessage: false })
    expect(mounted.text()).not.toContain(latestMessageWarning)
  })
})

describe('ChatTurnFilesChanged open file', () => {
  beforeEach(() => {
    routeState.name = 'project-chat'
    routeState.params = { slug: 'proj' }
    fleetState.projects = [
      { id: 'proj-1', slug: 'proj', name: 'Proj', rootPath: '/tmp/proj' },
    ]
    fleetState.groups = []
    fleetState.activeProjectId = 'proj-1'
    vi.mocked(openAtLine).mockReset()
    vi.mocked(openAtLine).mockResolvedValue(undefined)
    vi.mocked(toast.error).mockReset()
  })

  it('opens the file at the change path when a row is clicked', async () => {
    const mounted = mountBlock({})
    const row = mounted.get('[role="button"]')

    await row.trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledWith('proj-1', cumulativeChanges[0]!.path)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('opens the rename destination when a renamed row is clicked', async () => {
    const renamed: AggregatedTurnFileChange[] = [
      {
        path: 'old.ts',
        operation: 'rename',
        additions: 0,
        deletions: 0,
        renameTo: 'new.ts',
      },
    ]
    const mounted = mountBlock({ changes: renamed, restoreEnabled: false })
    const row = mounted.get('[role="button"]')

    await row.trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledWith('proj-1', 'new.ts')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('opens the terminal destination when a rename chain is clicked', async () => {
    const chained: AggregatedTurnFileChange[] = [
      {
        path: 'a.ts',
        operation: 'rename',
        additions: 0,
        deletions: 0,
        renameTo: 'b.ts',
      },
      {
        path: 'b.ts',
        operation: 'rename',
        additions: 0,
        deletions: 0,
        renameTo: 'c.ts',
      },
    ]
    const mounted = mountBlock({ changes: chained, restoreEnabled: false })
    const row = mounted.get('[role="button"]')

    await row.trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledTimes(1)
    expect(openAtLine).toHaveBeenCalledWith('proj-1', 'c.ts')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('opens a fallback path when rename targets form a cycle', async () => {
    const cycled: AggregatedTurnFileChange[] = [
      {
        path: 'a.ts',
        operation: 'rename',
        additions: 0,
        deletions: 0,
        renameTo: 'b.ts',
      },
      {
        path: 'b.ts',
        operation: 'rename',
        additions: 0,
        deletions: 0,
        renameTo: 'a.ts',
      },
    ]
    const mounted = mountBlock({ changes: cycled, restoreEnabled: false })
    const row = mounted.get('[role="button"]')

    await row.trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledTimes(1)
    expect(openAtLine).toHaveBeenCalledWith('proj-1', 'a.ts')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('opens the change path when a deleted row has a stale rename destination', async () => {
    const deleted: AggregatedTurnFileChange[] = [
      {
        path: 'old.ts',
        operation: 'delete',
        additions: 0,
        deletions: 1,
        renameTo: 'new.ts',
      },
    ]
    const mounted = mountBlock({ changes: deleted, restoreEnabled: false })
    const row = mounted.get('[role="button"]')

    await row.trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledWith('proj-1', 'old.ts')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('opens the change path when a non-rename row has a stale rename destination', async () => {
    const updated: AggregatedTurnFileChange[] = [
      {
        path: 'kept.ts',
        operation: 'update',
        additions: 1,
        deletions: 0,
        renameTo: 'moved.ts',
      },
    ]
    const mounted = mountBlock({ changes: updated, restoreEnabled: false })
    const row = mounted.get('[role="button"]')

    await row.trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledWith('proj-1', 'kept.ts')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('opens the file when Enter is pressed on a focused row', async () => {
    const mounted = mountBlock({})
    const row = mounted.get('[role="button"]')

    await row.trigger('keydown.enter')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledWith('proj-1', cumulativeChanges[0]!.path)
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('toasts when openAtLine fails and does not surface an unhandled rejection', async () => {
    vi.mocked(openAtLine).mockRejectedValueOnce(new Error('disk error'))
    const mounted = mountBlock({})
    const row = mounted.get('[role="button"]')

    await row.trigger('click')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Failed to open file', {
      description: 'disk error',
    })
  })

  it('opens a slug-prefixed group change in the matching member project', async () => {
    routeState.params = { slug: 'stack' }
    fleetState.projects = [
      { id: 'proj-api', slug: 'api', name: 'API', rootPath: '/tmp/api' },
      { id: 'proj-web', slug: 'web', name: 'Web', rootPath: '/tmp/web' },
    ]
    fleetState.groups = [
      {
        id: 'group-1',
        name: 'Stack',
        slug: 'stack',
        memberSlugs: ['api', 'web'],
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
    ]
    fleetState.activeProjectId = 'proj-api'
    const grouped: AggregatedTurnFileChange[] = [
      { path: 'web/src/a.ts', operation: 'update', additions: 1, deletions: 0 },
    ]
    const mounted = mountBlock({ changes: grouped, restoreEnabled: false })
    const row = mounted.get('[role="button"]')

    await row.trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledWith('proj-web', 'src/a.ts')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('opens a slug-prefixed rename destination in the matching member project', async () => {
    routeState.params = { slug: 'stack' }
    fleetState.projects = [
      { id: 'proj-api', slug: 'api', name: 'API', rootPath: '/tmp/api' },
      { id: 'proj-web', slug: 'web', name: 'Web', rootPath: '/tmp/web' },
    ]
    fleetState.groups = [
      {
        id: 'group-1',
        name: 'Stack',
        slug: 'stack',
        memberSlugs: ['api', 'web'],
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
    ]
    const renamed: AggregatedTurnFileChange[] = [
      {
        path: 'web/old.ts',
        operation: 'rename',
        additions: 0,
        deletions: 0,
        renameTo: 'web/new.ts',
      },
    ]
    const mounted = mountBlock({ changes: renamed, restoreEnabled: false })
    const row = mounted.get('[role="button"]')

    await row.trigger('click')
    await flushPromises()

    expect(openAtLine).toHaveBeenCalledWith('proj-web', 'new.ts')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('keeps prefix parsing when one group member is missing and toasts for that slug', async () => {
    routeState.params = { slug: 'stack' }
    fleetState.projects = [
      { id: 'proj-web', slug: 'web', name: 'Web', rootPath: '/tmp/web' },
    ]
    fleetState.groups = [
      {
        id: 'group-1',
        name: 'Stack',
        slug: 'stack',
        memberSlugs: ['api', 'web'],
        lastOpened: '2026-01-01T00:00:00.000Z',
      },
    ]
    fleetState.activeProjectId = 'proj-web'
    const grouped: AggregatedTurnFileChange[] = [
      { path: 'api/src/a.ts', operation: 'update', additions: 1, deletions: 0 },
    ]
    const mounted = mountBlock({ changes: grouped, restoreEnabled: false })
    const row = mounted.get('[role="button"]')

    await row.trigger('click')
    await flushPromises()

    expect(openAtLine).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('Project not found', {
      description: 'Project api is no longer available.',
    })
  })
})
