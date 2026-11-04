import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'

const treeRequest = vi.hoisted(() => {
  const state: {
    resolve: (value: unknown) => void
    reject: (error: unknown) => void
  } = {
    resolve: () => {},
    reject: () => {},
  }
  const fsListDirTree = vi.fn(
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
    fsListDir: vi.fn(async () => []),
  }),
)

vi.mock('vue-sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/composables/use-workbench-store', () => ({
  default: () => ({
    getProject: (id: string) =>
      id === 'proj-1'
        ? {
            id,
            name: 'eva',
            rootPath: 'ssh://aidanhibbard@eva/home/aidanhibbard',
          }
        : null,
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

  const mountTree = async (): Promise<VueWrapper> => {
    const { default: WorkbenchFileTree } = await import(
      '@/components/workbench/WorkbenchFileTree.vue'
    )
    wrapper = mount(WorkbenchFileTree, {
      props: {
        projectId: 'proj-1',
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
})
