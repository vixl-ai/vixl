import { ref, watch, type ComputedRef, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import { fsStat } from '@/services/vixl/vixl-tauri'

export default (
  projectRoot: Ref<string | null> | ComputedRef<string | null>,
  openPaths: Ref<string[]> | ComputedRef<string[]>,
) => {
  const missing = ref(new Set<string>())

  let refreshGeneration = 0

  const isMissing = (path: string): boolean => missing.value.has(path)

  const refreshMissing = async (): Promise<void> => {
    const generation = ++refreshGeneration
    const root = projectRoot.value
    const paths = openPaths.value

    if (!root || paths.length === 0) {
      if (generation === refreshGeneration) {
        missing.value = new Set()
      }
      return
    }

    try {
      const results = await Promise.all(
        paths.map(async (path) => {
          const stat = await fsStat(root, path)
          return { path, exists: stat.exists }
        }),
      )

      if (generation !== refreshGeneration) {
        return
      }

      const next = new Set<string>()
      for (const result of results) {
        if (!result.exists) {
          next.add(result.path)
        }
      }
      missing.value = next
    } catch (error) {
      if (generation !== refreshGeneration) {
        return
      }
      toast.error('Failed to check open files', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  watch(
    [projectRoot, openPaths],
    () => {
      refreshMissing().catch((error) => {
        toast.error('Failed to check open files', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    },
    { immediate: true },
  )

  return {
    isMissing,
    refreshMissing,
  }
}
