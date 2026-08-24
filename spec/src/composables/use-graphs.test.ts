import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { toast } from 'vue-sonner'
import { mockVixlTauri } from '../test-utils/mocks/vixl-tauri'
import type { GraphListItem } from '@/types/codegraph/graph-list-item'
import useGraphs from '@/composables/use-graphs'

const listGraphs = vi.hoisted(() =>
  vi.fn<() => Promise<GraphListItem[]>>(async () => []),
)
const deleteGraph = vi.hoisted(() =>
  vi.fn<(id: string) => Promise<void>>(async () => undefined),
)

vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    listGraphs: () => listGraphs(),
    deleteGraph: (id: string) => deleteGraph(id),
  }),
)

const flush = async (): Promise<void> => {
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
}

const graphA: GraphListItem = {
  id: 'a'.repeat(64),
  name: 'alpha',
  projectRoot: '/tmp/alpha',
  storeDir: '/tmp/vixl/graphs/aa',
  bytes: 2048,
  missing: false,
}

describe('use-graphs', () => {
  beforeEach(() => {
    listGraphs.mockReset()
    deleteGraph.mockReset()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
    listGraphs.mockResolvedValue([])
  })

  it('refreshes the same list after delete', async () => {
    listGraphs
      .mockResolvedValueOnce([graphA])
      .mockResolvedValueOnce([])
    deleteGraph.mockResolvedValue(undefined)

    const graphs = useGraphs()
    await flush()

    expect(graphs.data.value).toEqual([graphA])

    const deleted = await graphs.remove(graphA.id)

    expect(deleted).toBe(true)
    expect(deleteGraph).toHaveBeenCalledWith(graphA.id)
    expect(listGraphs).toHaveBeenCalledTimes(2)
    expect(graphs.data.value).toEqual([])
    expect(toast.success).toHaveBeenCalled()
  })

  it('maps snake_case graph records', async () => {
    listGraphs.mockResolvedValueOnce([
      {
        id: graphA.id,
        name: graphA.name,
        project_root: graphA.projectRoot,
        store_dir: graphA.storeDir,
        bytes: graphA.bytes,
        missing: false,
      } as unknown as GraphListItem,
    ])

    const graphs = useGraphs()
    await flush()

    expect(graphs.data.value[0]?.projectRoot).toBe(graphA.projectRoot)
    expect(graphs.data.value[0]?.storeDir).toBe(graphA.storeDir)
  })
})
