import type { ModelMessage } from 'ai'

const IMAGE_REJECTION_RE =
  /invalid png|invalid image|invalid jpeg|could not process image|unsupported image|image input|image_url/i

type ContentPart = {
  type: string
  mediaType?: string
  filename?: string
}

const isImagePart = (part: ContentPart): boolean => {
  if (part.type === 'image') {
    return true
  }
  if (part.type !== 'file') {
    return false
  }
  return (part.mediaType ?? '').toLowerCase().startsWith('image/')
}

const attachmentPlaceholder = (part: ContentPart): { type: 'text'; text: string } => ({
  type: 'text',
  text: `[Attachment: ${part.filename || 'file'} (${part.mediaType || 'unknown'})]`,
})

export const isProviderImageRejection = (message: string): boolean =>
  IMAGE_REJECTION_RE.test(message)

export const countImageFileParts = (messages: ModelMessage[]): number => {
  let count = 0
  for (const message of messages) {
    if (!Array.isArray(message.content)) {
      continue
    }
    for (const part of message.content) {
      if (isImagePart(part)) {
        count += 1
      }
    }
  }
  return count
}

export const downgradeImageFileParts = (
  messages: ModelMessage[],
): ModelMessage[] =>
  messages.map((message) => {
    if (!Array.isArray(message.content)) {
      return message
    }
    let changed = false
    const content = message.content.map((part) => {
      if (!isImagePart(part)) {
        return part
      }
      changed = true
      return attachmentPlaceholder(part)
    })
    if (!changed) {
      return message
    }
    return {
      ...message,
      content,
    } as ModelMessage
  })

export const providerImageRejectionNote = (count: number): string =>
  `The provider rejected ${count} image(s) and the run continued without them.`
