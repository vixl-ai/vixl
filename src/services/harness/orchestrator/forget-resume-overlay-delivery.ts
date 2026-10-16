import itemsByChat from './resume-overlay-cache'

export default (input: { chatId: string; toolCallId: string }): void => {
  const items = itemsByChat.get(input.chatId)
  if (!items) {
    return
  }
  const prefix = `${input.toolCallId}:`
  for (const item of items) {
    if (item.kind !== 'wake') {
      continue
    }
    item.resultKeys = item.resultKeys.filter((key) => !key.startsWith(prefix))
  }
}
