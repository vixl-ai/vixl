import type { ModelMessage } from 'ai'

export default (message: ModelMessage): string => {
  if (typeof message.content === 'string') {
    return message.content
  }
  try {
    return JSON.stringify(message.content)
  } catch {
    return ''
  }
}
