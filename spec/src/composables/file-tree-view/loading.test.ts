import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const treeRequest = vi.hoisted(() => {
  const state: {
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  } = {
    resolve: () => {},
    reject: () => {},
  }
  const fsListDirTree = vi.fn<() => Promise<unknown>>(
    () =>
      new Promise((resolve, reject) => {
        state.resolve = resolve
        state.reject = reject
      }),
  )
  return { fsListDirTree, state }
})

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    isTauri: () => false,
    fsListDirTree: treeRequest.fsListDirTree,
    fsListDir: vi.fn<(projectRoot: string, path: string) => Promise<never[]>>(async () => []),
  }),
)

vi.mock('vue-sonner', () => ({
  toast: {
    error: vi.fn<(...args: unknown[]) => void>(),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    getProject: (id: string) => {
      if (id === 'proj-1') {
        return {
          id,
          name: 'eva',
          rootPath: 'ssh://aidanhibbard@eva/home/aidanhibbard',
        }
      }
      if (id === 'proj-local') {
        return {
          id,
          name: 'local',
          rootPath: '/Users/aidanhibbard/src/app',
        }
      }
      if (id === '_home_') {
        return {
          id,
          name: 'Home',
          rootPath: '/Users/aidanhibbard',
        }
      }
      return null
    },
  }),
}))

const flush = async (): Promise<void> => {
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

describe('file tree loading state', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    treeRequest.fsListDirTree.mockClear()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  const mountTree = async (projectId = 'proj-1'): Promise<VueWrapper> => {
    const { default: WorkbenchFileTree } = await import(
      '@/components/workbench/WorkbenchFileTree.vue'
    )
    wrapper = mount(WorkbenchFileTree, {
      props: {
        projectId,
        showToolbar: false,
        hideChrome: true,
        embedded: true,
      },
    })
    await flush()
    return wrapper
  }

  it('fills the tree with skeletons until the directory listing returns', async () => {
    const view = await mountTree()

    expect(view.findAll('[data-slot="skeleton"]').length).toBeGreaterThan(8)
    expect(view.text()).not.toContain('Loading files')
    expect(view.emitted('loading')?.at(-1)).toEqual([true])

    treeRequest.state.resolve({
      name: '.',
      path: '.',
      kind: 'directory',
      children: [{ name: 'SYSTEM.md', path: 'SYSTEM.md', kind: 'file' }],
    })
    await flush()

    expect(view.text()).toContain('SYSTEM.md')
    expect(view.findAll('[data-slot="skeleton"]')).toHaveLength(0)
    expect(view.emitted('loading')?.at(-1)).toEqual([false])
  })

  it('clears the skeletons when the listing fails', async () => {
    const view = await mountTree()

    expect(view.findAll('[data-slot="skeleton"]').length).toBeGreaterThan(8)

    treeRequest.state.reject(new Error('timed out'))
    await flush()

    expect(view.findAll('[data-slot="skeleton"]')).toHaveLength(0)
    expect(view.emitted('loading')?.at(-1)).toEqual([false])
  })

  it('requests a depth-1 tree for ssh project roots', async () => {
    await mountTree()

    expect(treeRequest.fsListDirTree).toHaveBeenCalledWith(
      'ssh://aidanhibbard@eva/home/aidanhibbard',
      '.',
      1,
    )
  })

  it('requests a depth-4 tree for local project roots', async () => {
    await mountTree('proj-local')

    expect(treeRequest.fsListDirTree).toHaveBeenCalledWith(
      '/Users/aidanhibbard/src/app',
      '.',
      4,
    )
  })

  it('requests a depth-2 tree for the home chat slug', async () => {
    await mountTree(HOME_CHAT_SLUG)

    expect(treeRequest.fsListDirTree).toHaveBeenCalledWith(
      '/Users/aidanhibbard',
      '.',
      2,
    )
  })
})
