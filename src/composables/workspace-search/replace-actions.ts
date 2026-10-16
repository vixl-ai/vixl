import { toast } from 'vue-sonner'
import type { ComputedRef, Ref } from 'vue'
import {
  replaceAllFiles,
  replaceHit,
  replaceInFile,
} from '@/services/workspace-search'
import type { GrepMatch } from '@/services/vixl/vixl-tauri'
import type { SearchFileGroup } from '@/types/workbench/search-file-group'
import type { SearchReplaceOptions } from '@/types/workbench/search-replace-options'

export type WorkspaceSearchReplaceDeps = {
  projectRoot: Ref<string | null>
  findQuery: Ref<string>
  replaceQuery: Ref<string>
  replacing: Ref<boolean>
  groups: Ref<SearchFileGroup[]>
  replaceOptions: ComputedRef<SearchReplaceOptions>
  refreshAfterReplace: () => Promise<void>
}

export const createWorkspaceSearchReplaceActions = (
  deps: WorkspaceSearchReplaceDeps,
) => {
  const requireFind = (): string | null => {
    const find = deps.findQuery.value
    return find ? find : null
  }

  const rootForGroup = (group: SearchFileGroup | undefined): string | null =>
    group?.projectRoot ?? deps.projectRoot.value

  const rootForHit = (hit: GrepMatch): string | null => {
    const group = deps.groups.value.find((item) => item.hits.includes(hit))
    return rootForGroup(group)
  }

  const replaceOne = async (): Promise<void> => {
    const find = requireFind()
    const firstGroup = deps.groups.value[0]
    const firstHit = firstGroup?.hits[0]
    const root = rootForGroup(firstGroup)
    if (!find || !root || !firstHit || deps.replacing.value) {
      return
    }
    deps.replacing.value = true
    try {
      await replaceHit({
        projectRoot: root,
        find,
        replace: deps.replaceQuery.value,
        options: deps.replaceOptions.value,
        hit: firstHit,
      })
      await deps.refreshAfterReplace()
    } catch (error) {
      toast.error('Failed to replace', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      deps.replacing.value = false
    }
  }

  const replaceMatch = async (hit: GrepMatch): Promise<void> => {
    const find = requireFind()
    const root = rootForHit(hit)
    if (!find || !root || deps.replacing.value) {
      return
    }
    deps.replacing.value = true
    try {
      await replaceHit({
        projectRoot: root,
        find,
        replace: deps.replaceQuery.value,
        options: deps.replaceOptions.value,
        hit,
      })
      await deps.refreshAfterReplace()
    } catch (error) {
      toast.error('Failed to replace', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      deps.replacing.value = false
    }
  }

  const replaceFile = async (path: string, memberSlug?: string): Promise<void> => {
    const find = requireFind()
    const group = deps.groups.value.find(
      (item) =>
        item.path === path &&
        (memberSlug ? item.memberSlug === memberSlug : true),
    )
    const root = rootForGroup(group)
    if (!find || !root || deps.replacing.value) {
      return
    }
    deps.replacing.value = true
    try {
      await replaceInFile({
        projectRoot: root,
        path,
        find,
        replace: deps.replaceQuery.value,
        options: deps.replaceOptions.value,
      })
      await deps.refreshAfterReplace()
    } catch (error) {
      toast.error('Failed to replace in file', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      deps.replacing.value = false
    }
  }

  const replaceAll = async (): Promise<void> => {
    const find = requireFind()
    const fallbackRoot = deps.projectRoot.value
    const firstRoot = rootForGroup(deps.groups.value[0])
    const root = firstRoot ?? fallbackRoot
    if (!find || !root || deps.groups.value.length === 0 || deps.replacing.value) {
      return
    }
    deps.replacing.value = true
    try {
      const result = await replaceAllFiles({
        projectRoot: root,
        groups: deps.groups.value,
        find,
        replace: deps.replaceQuery.value,
        options: deps.replaceOptions.value,
      })
      await deps.refreshAfterReplace()
      const occurrenceWord = result.occurrenceCount === 1 ? 'occurrence' : 'occurrences'
      const fileWord = result.fileCount === 1 ? 'file' : 'files'
      toast.success(
        `Replaced ${result.occurrenceCount} ${occurrenceWord} across ${result.fileCount} ${fileWord}`,
      )
    } catch (error) {
      toast.error('Failed to replace all', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      deps.replacing.value = false
    }
  }

  return {
    replaceOne,
    replaceMatch,
    replaceFile,
    replaceAll,
  }
}
