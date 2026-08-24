import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import { workspaceGrep } from '@/services/vixl/vixl-tauri'
import { groupMatches } from '@/services/workspace-search'
import type { SearchFileGroup } from '@/types/workbench/search-file-group'
import type { SearchReplaceOptions } from '@/types/workbench/search-replace-options'
import { createWorkspaceSearchReplaceActions } from './replace-actions'

const SEARCH_DEBOUNCE_MS = 200
const SEARCH_MAX_RESULTS = 10000

export default (projectRoot: Ref<string | null>) => {
  const findQuery = ref('')
  const replaceQuery = ref('')
  const replaceExpanded = ref(false)
  const matchCase = ref(false)
  const matchWholeWord = ref(false)
  const useRegex = ref(false)
  const includeGlob = ref('')
  const excludeGlob = ref('')
  const pending = ref(false)
  const replacing = ref(false)
  const truncated = ref(false)
  const groups = ref<SearchFileGroup[]>([])
  const collapsedPaths = ref(new Set<string>())
  const searchGeneration = ref(0)

  const resultCount = computed(() =>
    groups.value.reduce((total, group) => total + group.hits.length, 0),
  )

  const fileCount = computed(() => groups.value.length)

  const summaryLabel = computed(() => {
    const results = resultCount.value
    const files = fileCount.value
    const resultWord = results === 1 ? 'result' : 'results'
    const fileWord = files === 1 ? 'file' : 'files'
    const base = `${results} ${resultWord} in ${files} ${fileWord}`
    if (truncated.value) {
      return `${base} (truncated)`
    }
    return base
  })

  const replaceOptions = computed((): SearchReplaceOptions => ({
    matchCase: matchCase.value,
    wholeWord: matchWholeWord.value,
    regex: useRegex.value,
  }))

  const resetResults = (): void => {
    groups.value = []
    truncated.value = false
    collapsedPaths.value = new Set()
    pending.value = false
  }

  const isGroupOpen = (path: string): boolean => !collapsedPaths.value.has(path)

  const setGroupOpen = (path: string, open: boolean): void => {
    const next = new Set(collapsedPaths.value)
    if (open) {
      next.delete(path)
    } else {
      next.add(path)
    }
    collapsedPaths.value = next
  }

  const runSearch = async (rawQuery: string): Promise<void> => {
    const pattern = rawQuery.trim()
    const root = projectRoot.value

    if (!pattern || !root) {
      resetResults()
      return
    }

    if (useRegex.value) {
      try {
        RegExp(pattern)
      } catch (error) {
        resetResults()
        toast.error('Invalid regular expression', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
        return
      }
    }

    const generation = ++searchGeneration.value
    pending.value = true

    try {
      const include = includeGlob.value.trim()
      const exclude = excludeGlob.value.trim()
      const result = await workspaceGrep({
        projectRoot: root,
        pattern,
        glob: include || undefined,
        excludeGlob: exclude || undefined,
        caseInsensitive: !matchCase.value,
        maxResults: SEARCH_MAX_RESULTS,
        regex: useRegex.value,
        wholeWord: matchWholeWord.value,
      })
      if (generation !== searchGeneration.value) {
        return
      }
      groups.value = groupMatches(result.matches)
      truncated.value = result.truncated
      collapsedPaths.value = new Set()
    } catch (error) {
      if (generation !== searchGeneration.value) {
        return
      }
      resetResults()
      toast.error('Failed to search workspace', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      if (generation === searchGeneration.value) {
        pending.value = false
      }
    }
  }

  const debouncedSearch = useDebounceFn((rawQuery: string) => {
    runSearch(rawQuery).catch((error: unknown) => {
      toast.error('Failed to search workspace', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    })
  }, SEARCH_DEBOUNCE_MS)

  const scheduleSearch = (): void => {
    const pattern = findQuery.value.trim()
    if (!pattern) {
      searchGeneration.value += 1
      resetResults()
      return
    }
    pending.value = true
    debouncedSearch(findQuery.value)
  }

  const expandReplace = (): void => {
    replaceExpanded.value = true
  }

  const toggleReplaceExpanded = (): void => {
    replaceExpanded.value = !replaceExpanded.value
  }

  const refreshAfterReplace = async (): Promise<void> => {
    await runSearch(findQuery.value)
  }

  const { replaceOne, replaceMatch, replaceFile, replaceAll } =
    createWorkspaceSearchReplaceActions({
      projectRoot,
      findQuery,
      replaceQuery,
      replacing,
      groups,
      replaceOptions,
      refreshAfterReplace,
    })

  watch(findQuery, () => {
    scheduleSearch()
  })

  watch(
    [matchCase, matchWholeWord, useRegex, includeGlob, excludeGlob, projectRoot],
    () => {
      if (!findQuery.value.trim()) {
        return
      }
      scheduleSearch()
    },
  )

  return {
    findQuery,
    replaceQuery,
    replaceExpanded,
    matchCase,
    matchWholeWord,
    useRegex,
    includeGlob,
    excludeGlob,
    pending,
    replacing,
    truncated,
    groups,
    resultCount,
    fileCount,
    summaryLabel,
    isGroupOpen,
    setGroupOpen,
    expandReplace,
    toggleReplaceExpanded,
    replaceOne,
    replaceMatch,
    replaceFile,
    replaceAll,
    runSearch,
    scheduleSearch,
  }
}
