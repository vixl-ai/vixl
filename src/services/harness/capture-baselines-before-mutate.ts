import { fileCheckpointCapture } from '@/services/vixl/vixl-tauri'
import { checkpointCaptureTarget } from '@/services/harness/tool-roots'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

type CaptureContext = {
  projectRoot: string
  projectSlug: string
  chatId: string
  userMessageId?: string
  members?: HarnessWorkspaceMember[]
}

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
    const target = checkpointCaptureTarget(ctx, path)
    await fileCheckpointCapture({
      projectSlug: ctx.projectSlug,
      chatId: ctx.chatId,
      userMessageId: ctx.userMessageId,
      projectRoot: target.projectRoot,
      path: target.path,
      ...(target.key !== target.path ? { key: target.key } : {}),
      toolCallId,
    })
  }
}

export default captureBaselinesBeforeMutate
