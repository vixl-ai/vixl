import { fileCheckpointCapture, fsListDir, fsReadFile, fsStat } from '@/services/vixl/vixl-tauri'
import { checkpointCaptureTarget } from '@/services/harness/tool-roots'
import type { FileCheckpointCaptureResult } from '@/types/harness/file-checkpoint'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import { isSshProjectRoot } from '@/utils/ssh-project-root'

const MAX_BASELINE_BYTES = 2 * 1024 * 1024

type CaptureContext = {
  projectRoot: string
  projectSlug: string
  chatId: string
  userMessageId?: string
  members?: HarnessWorkspaceMember[]
}

const capturePathBaseline = async (
  ctx: CaptureContext,
  path: string,
  toolCallId?: string,
): Promise<FileCheckpointCaptureResult> => {
  if (!ctx.userMessageId) {
    throw new Error('Cannot mutate files without a user message checkpoint id')
  }
  if (!ctx.projectRoot.trim()) {
    throw new Error('Cannot mutate files without a project root')
  }
  const target = checkpointCaptureTarget(ctx, path)
  if (isSshProjectRoot(target.projectRoot)) {
    return captureSshBaseline(ctx, target.projectRoot, target.path, target.key, toolCallId)
  }
  return fileCheckpointCapture({
    projectSlug: ctx.projectSlug,
    chatId: ctx.chatId,
    userMessageId: ctx.userMessageId,
    projectRoot: target.projectRoot,
    path: target.path,
    ...(target.key !== target.path ? { key: target.key } : {}),
    toolCallId,
  })
}

const emptyCapture = (): FileCheckpointCaptureResult => ({
  captured: [],
  skippedOversize: [],
})

const mergeCapture = (
  left: FileCheckpointCaptureResult,
  right: FileCheckpointCaptureResult,
): FileCheckpointCaptureResult => ({
  captured: [...left.captured, ...right.captured],
  skippedOversize: [...left.skippedOversize, ...right.skippedOversize],
})

const captureSshFile = async (
  ctx: CaptureContext,
  projectRoot: string,
  relativePath: string,
  key: string,
  toolCallId: string | undefined,
  existed: boolean,
  content: string | undefined,
): Promise<FileCheckpointCaptureResult> => {
  if (!ctx.userMessageId) {
    throw new Error('Cannot mutate files without a user message checkpoint id')
  }
  return fileCheckpointCapture({
    projectSlug: ctx.projectSlug,
    chatId: ctx.chatId,
    userMessageId: ctx.userMessageId,
    projectRoot,
    path: relativePath,
    ...(key !== relativePath ? { key } : {}),
    toolCallId,
    existed,
    ...(existed && content !== undefined ? { content } : {}),
  })
}

const captureSshBaseline = async (
  ctx: CaptureContext,
  projectRoot: string,
  relativePath: string,
  key: string,
  toolCallId: string | undefined,
): Promise<FileCheckpointCaptureResult> => {
  let stat: { exists: boolean; kind: string; size: number }
  try {
    stat = await fsStat(projectRoot, relativePath)
  } catch {
    return captureSshFile(ctx, projectRoot, relativePath, key, toolCallId, false, undefined)
  }
  if (!stat.exists) {
    return captureSshFile(ctx, projectRoot, relativePath, key, toolCallId, false, undefined)
  }
  if (stat.kind === 'directory') {
    return captureSshDirectory(ctx, projectRoot, relativePath, key, toolCallId)
  }
  if (stat.size > MAX_BASELINE_BYTES) {
    return { captured: [], skippedOversize: [key] }
  }
  const read = await fsReadFile({
    projectRoot,
    path: relativePath,
    allowSensitive: true,
  })
  return captureSshFile(
    ctx,
    projectRoot,
    relativePath,
    key,
    toolCallId,
    true,
    read.content,
  )
}

const captureSshDirectory = async (
  ctx: CaptureContext,
  projectRoot: string,
  relativePath: string,
  keyPrefix: string,
  toolCallId: string | undefined,
): Promise<FileCheckpointCaptureResult> => {
  const entries = await fsListDir(projectRoot, relativePath)
  let merged = emptyCapture()
  for (const entry of entries) {
    const childRelative = relativePath
      ? `${relativePath.replace(/\/$/, '')}/${entry.name}`
      : entry.name
    const childKey = keyPrefix ? `${keyPrefix.replace(/\/$/, '')}/${entry.name}` : entry.name
    const child = await captureSshBaseline(ctx, projectRoot, childRelative, childKey, toolCallId)
    merged = mergeCapture(merged, child)
  }
  return merged
}

export const captureDirectoryBaseline = async (
  ctx: CaptureContext,
  path: string,
  toolCallId: string,
): Promise<FileCheckpointCaptureResult> => capturePathBaseline(ctx, path, toolCallId)

const captureBaselinesBeforeMutate = async (
  ctx: CaptureContext,
  paths: string[],
  toolCallId?: string,
): Promise<void> => {
  if (!ctx.userMessageId) {
    throw new Error('Cannot mutate files without a user message checkpoint id')
  }
  if (!ctx.projectRoot.trim()) {
    throw new Error('Cannot mutate files without a project root')
  }

  const uniquePaths = [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
  for (const path of uniquePaths) {
    await capturePathBaseline(ctx, path, toolCallId)
  }
}

export default captureBaselinesBeforeMutate
