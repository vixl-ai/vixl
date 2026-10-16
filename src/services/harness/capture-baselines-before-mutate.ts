import { fileCheckpointCapture } from '@/services/vixl/vixl-tauri'
import { checkpointCaptureTarget } from '@/services/harness/tool-roots'
import type { FileCheckpointCaptureResult } from '@/types/harness/file-checkpoint'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

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
