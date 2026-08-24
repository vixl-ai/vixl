import { open, save } from '@tauri-apps/plugin-dialog'
import { call, isTauri } from './helpers'
import type {
  FileDiffRecord,
  FsEditReplacement,
  WorkspaceGlobResult,
  WorkspaceGrepResult,
} from './types'

export const revealInFolder = (path: string): Promise<void> =>
  call('reveal_in_folder', { path })

export const openFolderPicker = async (): Promise<string | null> => {
  if (!isTauri()) {
    throw new Error('Vixl desktop APIs are only available in the Tauri app')
  }

  const selected = await open({
    directory: true,
    multiple: false,
  })

  if (selected === null) {
    return null
  }

  return Array.isArray(selected) ? (selected[0] ?? null) : selected
}

export const saveTextFileWithDialog = async (
  defaultName: string,
  content: string,
): Promise<boolean> => {
  if (!isTauri()) {
    throw new Error('Vixl desktop APIs are only available in the Tauri app')
  }

  const path = await save({
    defaultPath: defaultName,
    filters: [{ name: 'Text', extensions: ['txt', 'md'] }],
  })
  if (path === null) {
    return false
  }

  await call('write_text_file', { path, content })
  return true
}

export const fsReadFile = (args: {
  projectRoot: string
  path: string
  offset?: number
  limit?: number
  includeBase64?: boolean
}): Promise<{
  path: string
  content: string
  totalLines: number
  offset: number
  limit: number
  isImage?: boolean
  mimeType?: string
  sizeBytes?: number
  base64?: string
}> => call('fs_read_file', args)

export const fsWriteFile = (args: {
  projectRoot: string
  path: string
  content: string
}): Promise<unknown> => call('fs_write_file', args)

export const writeTempHandoff = (args: {
  content: string
}): Promise<{ path: string; filename: string }> => call('write_temp_handoff', args)

export const writeTempBytes = (args: {
  contentBase64: string
  kind: string
  extension: string
}): Promise<{ path: string; filename: string }> => call('write_temp_bytes', args)

export const appendTempLog = (args: {
  path?: string | null
  kind: string
  line: string
}): Promise<{ path: string; filename: string }> => call('append_temp_log', args)

export const fsEditFile = (args: {
  projectRoot: string
  path: string
  replacements: FsEditReplacement[]
}): Promise<FileDiffRecord> => call('fs_edit_file', args)

export const fsApplyPatch = (args: {
  projectRoot: string
  patch: string
}): Promise<unknown> => call('fs_apply_patch', args)

export const fsListDir = (
  projectRoot: string,
  path: string,
): Promise<Array<{ name: string; path: string; kind: string }>> =>
  call('fs_list_dir', { projectRoot, path })

export const fsStat = (
  projectRoot: string,
  path: string,
): Promise<{
  path: string
  exists: boolean
  kind: string
  size: number
  modifiedMs?: number
}> => call('fs_stat', { projectRoot, path })

export const fsListDirTree = (
  projectRoot: string,
  path: string,
  maxDepth?: number,
): Promise<unknown> => call('fs_list_dir_tree', { projectRoot, path, maxDepth })

export const fsRename = (args: {
  projectRoot: string
  from: string
  to: string
}): Promise<void> => call('fs_rename', args)

export const fsDelete = (args: {
  projectRoot: string
  path: string
  recursive?: boolean
}): Promise<void> => call('fs_delete', args)

export const fsCopy = (args: {
  projectRoot: string
  from: string
  to: string
}): Promise<void> => call('fs_copy', args)

export const fsMove = (args: {
  projectRoot: string
  from: string
  to: string
}): Promise<void> => call('fs_move', args)

export const fsMkdir = (args: {
  projectRoot: string
  path: string
}): Promise<void> => call('fs_mkdir', args)

export const fsStagePreviewWrite = (args: {
  projectRoot: string
  path: string
  content: string
}): Promise<FileDiffRecord[]> =>
  call('fs_stage_preview', {
    projectRoot: args.projectRoot,
    request: { kind: 'write', path: args.path, content: args.content },
  })

export const fsStagePreviewEdit = (args: {
  projectRoot: string
  path: string
  replacements: FsEditReplacement[]
}): Promise<FileDiffRecord[]> =>
  call('fs_stage_preview', {
    projectRoot: args.projectRoot,
    request: { kind: 'edit', path: args.path, replacements: args.replacements },
  })

export const fsStagePreviewApplyPatch = (args: {
  projectRoot: string
  patch: string
}): Promise<FileDiffRecord[]> =>
  call('fs_stage_preview', {
    projectRoot: args.projectRoot,
    request: { kind: 'applyPatch', patch: args.patch },
  })

export const fsStagePreviewDelete = (args: {
  projectRoot: string
  path: string
}): Promise<FileDiffRecord[]> =>
  call('fs_stage_preview', {
    projectRoot: args.projectRoot,
    request: { kind: 'delete', path: args.path },
  })

export const workspaceGrep = async (args: {
  projectRoot: string
  pattern: string
  glob?: string
  context?: number
  path?: string
  caseInsensitive?: boolean
  maxResults?: number
  /** When false, literal match (`--fixed-strings`). Omitted defaults to regex on the Rust side. */
  regex?: boolean
  wholeWord?: boolean
  excludeGlob?: string
}): Promise<WorkspaceGrepResult> => {
  const result = await call<WorkspaceGrepResult>('workspace_grep', { request: args })
  return result
}

export const workspaceGlob = async (
  projectRoot: string,
  pattern: string,
  limit?: number,
): Promise<WorkspaceGlobResult> => {
  const result = await call<WorkspaceGlobResult>('workspace_glob', {
    request: { projectRoot, pattern, limit },
  })
  return result
}
