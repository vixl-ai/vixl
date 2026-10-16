import { toast } from 'vue-sonner'
import type { Ref } from 'vue'
import { workspaceGrep } from '@/services/vixl/vixl-tauri'
import { groupMatches } from '@/services/workspace-search'
import type {
  SearchFileGroup,
  SearchMemberSection,
} from '@/types/workbench/search-file-group'
import type { SearchReplaceOptions } from '@/types/workbench/search-replace-options'
import type { WorkspaceSearchMember } from '@/types/workbench/search-member'
import { createWorkspaceSearchReplaceActions } from './replace-actions'

const SEARCH_DEBOUNCE_MS = 200
const SEARCH_MAX_RESULTS = 10000
export const SEARCH_MAX_RESULTS_PER_MEMBER = 100

const stampMemberGroups = (
  member: WorkspaceSearchMember,
  matches: SearchFileGroup['hits'],
): SearchFileGroup[] =>
  groupMatches(matches).map((group) => ({
    ...group,
    memberSlug: member.slug,
    projectId: member.projectId,
    projectRoot: member.rootPath,
  }))

export default (
  projectRoot: Ref<string | null>,
  members?: Ref<WorkspaceSearchMember[] | null>,
) => {
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
  const memberSections = ref<SearchMemberSection[]>([])
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
    memberSections.value = []
    truncated.value = false
    collapsedPaths.value = new Set()
    pending.value = false
  }

  const multiMembers = (): WorkspaceSearchMember[] | null => {
    const list = members?.value
    if (!list || list.length <= 1) {
      return null
    }
    return list.filter((member) => member.rootPath.trim().length > 0)
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

  const grepArgs = (pattern: string, root: string, maxResults: number) => {
    const include = includeGlob.value.trim()
    const exclude = excludeGlob.value.trim()
    return {
      projectRoot: root,
      pattern,
      glob: include || undefined,
      excludeGlob: exclude || undefined,
      caseInsensitive: !matchCase.value,
      maxResults,
      regex: useRegex.value,
      wholeWord: matchWholeWord.value,
    }
  }

  const runSearch = async (rawQuery: string): Promise<void> => {
    const pattern = rawQuery.trim()
    const fanOut = multiMembers()
    const root = projectRoot.value

    if (!pattern || (!fanOut && !root) || (fanOut && fanOut.length === 0)) {
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
      if (fanOut) {
        const settled = await Promise.all(
          fanOut.map(async (member) => {
            const result = await workspaceGrep(
              grepArgs(pattern, member.rootPath, SEARCH_MAX_RESULTS_PER_MEMBER),
            )
            return { member, result }
          }),
        )
        if (generation !== searchGeneration.value) {
          return
        }
        const sections: SearchMemberSection[] = []
        const stamped: SearchFileGroup[] = []
        let anyTruncated = false
        for (const { member, result } of settled) {
          const fileGroups = stampMemberGroups(member, result.matches)
          sections.push({
            slug: member.slug,
            projectId: member.projectId,
            truncated: result.truncated,
            groups: fileGroups,
          })
          stamped.push(...fileGroups)
          if (result.truncated) {
            anyTruncated = true
          }
        }
        groups.value = stamped
        memberSections.value = sections
        truncated.value = anyTruncated
        collapsedPaths.value = new Set()
      } else {
        const result = await workspaceGrep(
          grepArgs(pattern, root!, SEARCH_MAX_RESULTS),
        )
        if (generation !== searchGeneration.value) {
          return
        }
        groups.value = groupMatches(result.matches)
        memberSections.value = []
        truncated.value = result.truncated
        collapsedPaths.value = new Set()
      }
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
    [
      matchCase,
      matchWholeWord,
      useRegex,
      includeGlob,
      excludeGlob,
      projectRoot,
      () => members?.value,
    ],
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
    memberSections,
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
