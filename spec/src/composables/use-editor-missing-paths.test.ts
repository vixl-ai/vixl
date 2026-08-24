import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { toast } from 'vue-sonner'
import { mockVixlTauri } from '../test-utils/mocks/vixl-tauri'

const fsStat = vi.hoisted(() =>
  vi.fn<(projectRoot: string, path: string) => Promise<{
    path: string
    exists: boolean
    kind: string
    size: number
  }>>(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsStat: (...args: [string, string]) => fsStat(...args),
  }),
)

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const flush = async (): Promise<void> => {
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
}

const existingStat = (path: string) => ({
  path,
  exists: true,
  kind: 'file',
  size: 10,
})

const missingStat = (path: string) => ({
  path,
  exists: false,
  kind: 'missing',
  size: 0,
})

describe('useEditorMissingPaths', () => {
  beforeEach(() => {
    vi.resetModules()
    fsStat.mockReset()
    vi.mocked(toast.error).mockClear()
  })

  it('marks a path when fsStat.exists is false', async () => {
    fsStat.mockImplementation(async (_root, path) => missingStat(path))
    const { default: useEditorMissingPaths } = await import(
      '@/composables/use-editor-missing-paths'
    )
    const projectRoot = ref<string | null>('/tmp/proj')
    const openPaths = ref(['src/gone.ts'])

    const { isMissing } = useEditorMissingPaths(projectRoot, openPaths)
    await flush()

    expect(fsStat).toHaveBeenCalledWith('/tmp/proj', 'src/gone.ts')
    expect(isMissing('src/gone.ts')).toBe(true)
  })

  it('does not mark a path that still exists', async () => {
    fsStat.mockImplementation(async (_root, path) => existingStat(path))
    const { default: useEditorMissingPaths } = await import(
      '@/composables/use-editor-missing-paths'
    )
    const projectRoot = ref<string | null>('/tmp/proj')
    const openPaths = ref(['src/main.ts'])

    const { isMissing } = useEditorMissingPaths(projectRoot, openPaths)
    await flush()

    expect(isMissing('src/main.ts')).toBe(false)
  })

  it('marks a nested open path after its folder is gone', async () => {
    fsStat.mockImplementation(async (_root, path) => missingStat(path))
    const { default: useEditorMissingPaths } = await import(
      '@/composables/use-editor-missing-paths'
    )
    const projectRoot = ref<string | null>('/tmp/proj')
    const openPaths = ref(['src/nested/file.ts'])

    const { isMissing } = useEditorMissingPaths(projectRoot, openPaths)
    await flush()

    expect(fsStat).toHaveBeenCalledWith('/tmp/proj', 'src/nested/file.ts')
    expect(isMissing('src/nested/file.ts')).toBe(true)
  })

  it('updates missing state when refreshMissing sees changed stats', async () => {
    fsStat.mockImplementation(async (_root, path) => existingStat(path))
    const { default: useEditorMissingPaths } = await import(
      '@/composables/use-editor-missing-paths'
    )
    const projectRoot = ref<string | null>('/tmp/proj')
    const openPaths = ref(['src/main.ts'])

    const { isMissing, refreshMissing } = useEditorMissingPaths(
      projectRoot,
      openPaths,
    )
    await flush()
    expect(isMissing('src/main.ts')).toBe(false)

    fsStat.mockImplementation(async (_root, path) => missingStat(path))
    await refreshMissing()

    expect(isMissing('src/main.ts')).toBe(true)
  })

  it('toasts an error when fsStat fails', async () => {
    fsStat.mockRejectedValue(new Error('stat failed'))
    const { default: useEditorMissingPaths } = await import(
      '@/composables/use-editor-missing-paths'
    )
    const projectRoot = ref<string | null>('/tmp/proj')
    const openPaths = ref(['src/main.ts'])

    useEditorMissingPaths(projectRoot, openPaths)
    await flush()

    expect(toast.error).toHaveBeenCalledWith('Failed to check open files', {
      description: 'stat failed',
    })
  })
})
