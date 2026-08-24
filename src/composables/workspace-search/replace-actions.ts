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
  const requireRootAndFind = (): { root: string; find: string } | null => {
    const root = deps.projectRoot.value
    const find = deps.findQuery.value
    if (!root || !find) {
      return null
    }
    return { root, find }
  }

  const replaceOne = async (): Promise<void> => {
    const ctx = requireRootAndFind()
    const firstHit = deps.groups.value[0]?.hits[0]
    if (!ctx || !firstHit || deps.replacing.value) {
      return
    }
    deps.replacing.value = true
    try {
      await replaceHit({
        projectRoot: ctx.root,
        find: ctx.find,
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
    const ctx = requireRootAndFind()
    if (!ctx || deps.replacing.value) {
      return
    }
    deps.replacing.value = true
    try {
      await replaceHit({
        projectRoot: ctx.root,
        find: ctx.find,
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

  const replaceFile = async (path: string): Promise<void> => {
    const ctx = requireRootAndFind()
    if (!ctx || deps.replacing.value) {
      return
    }
    deps.replacing.value = true
    try {
      await replaceInFile({
        projectRoot: ctx.root,
        path,
        find: ctx.find,
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
    const ctx = requireRootAndFind()
    if (!ctx || deps.groups.value.length === 0 || deps.replacing.value) {
      return
    }
    deps.replacing.value = true
    try {
      const result = await replaceAllFiles({
        projectRoot: ctx.root,
        groups: deps.groups.value,
        find: ctx.find,
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
