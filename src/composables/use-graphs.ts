import { onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import type { GraphListItem } from '@/types/codegraph/graph-list-item'
import { deleteGraph, listGraphs } from '@/services/vixl/vixl-tauri'

type GraphListRecord = GraphListItem & {
  project_root?: string
  store_dir?: string
}

const mapGraph = (record: GraphListRecord): GraphListItem => ({
  id: record.id,
  name: record.name,
  projectRoot: record.projectRoot || record.project_root || '',
  storeDir: record.storeDir || record.store_dir || '',
  bytes: record.bytes,
  missing: record.missing,
})

export default () => {
  const data = ref<GraphListItem[]>([])
  const pending = ref(false)
  const error = ref<unknown>(null)
  const loaded = ref(false)

  const refresh = async (): Promise<void> => {
    pending.value = true
    error.value = null
    try {
      const records = await listGraphs()
      data.value = records.map(mapGraph)
      loaded.value = true
    } catch (caught) {
      error.value = caught
      toast.error('Failed to load graphs', {
        description: caught instanceof Error ? caught.message : 'Unknown error',
      })
    } finally {
      pending.value = false
    }
  }

  const remove = async (id: string): Promise<boolean> => {
    try {
      await deleteGraph(id)
      await refresh()
      toast.success('Graph deleted')
      return true
    } catch (caught) {
      toast.error('Failed to delete graph', {
        description: caught instanceof Error ? caught.message : 'Unknown error',
      })
      return false
    }
  }

  refresh().catch((caught: unknown) => {
    toast.error('Failed to load graphs', {
      description: caught instanceof Error ? caught.message : 'Unknown error',
    })
  })

  onMounted(async () => {
    if (!loaded.value && !pending.value) {
      await refresh()
    }
  })

  return {
    data,
    pending,
    error,
    refresh,
    remove,
  }
}
