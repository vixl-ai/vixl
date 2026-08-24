import { truncateChatLog } from '@/services/vixl/vixl-tauri'

export const truncateChatLogBeforeMessage = async (
  projectSlug: string,
  chatId: string,
  messageId: string,
): Promise<void> => {
  await truncateChatLog({
    projectSlug,
    chatId,
    beforeMessageId: messageId,
  })
}

export const truncateChatLogAfterLastUser = async (
  projectSlug: string,
  chatId: string,
): Promise<void> => {
  await truncateChatLog({
    projectSlug,
    chatId,
    keepThroughLastUser: true,
  })
}

export const truncateChatLogAfterUserMessage = async (
  projectSlug: string,
  chatId: string,
  messageId: string,
): Promise<void> => {
  await truncateChatLog({
    projectSlug,
    chatId,
    keepThroughMessageId: messageId,
  })
}
