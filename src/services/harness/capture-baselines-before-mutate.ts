import { fileCheckpointCapture } from '@/services/vixl/vixl-tauri'

type CaptureContext = {
  projectRoot: string
  projectSlug: string
  chatId: string
  userMessageId?: string
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
    await fileCheckpointCapture({
      projectSlug: ctx.projectSlug,
      chatId: ctx.chatId,
      userMessageId: ctx.userMessageId,
      projectRoot: ctx.projectRoot,
      path,
      toolCallId,
    })
  }
}

export default captureBaselinesBeforeMutate
