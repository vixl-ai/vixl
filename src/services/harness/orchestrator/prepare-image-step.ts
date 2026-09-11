import type { ModelMessage } from 'ai'
import { drainStagedImages } from '@/services/harness/image-stage'

type PrepareStepOptions = {
  messages: ModelMessage[]
}

type PrepareStepResult = {
  messages?: ModelMessage[]
}

type PrepareStepFn = (
  options: PrepareStepOptions,
) => Promise<PrepareStepResult | undefined>

export default (args: {
  chatId: string
  turnId: string
  inner: PrepareStepFn
}) =>
  async (options: PrepareStepOptions): Promise<PrepareStepResult | undefined> => {
    const innerResult = await args.inner(options)
    const staged = drainStagedImages({
      chatId: args.chatId,
      turnId: args.turnId,
    })

    if (staged.length === 0) {
      return innerResult
    }

    const sources = staged.map((image) => image.source).join(', ')
    const imageMessage: ModelMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Images loaded by tools (sources: ${sources}):`,
        },
        ...staged.map((image) => ({
          type: 'file' as const,
          data: image.dataUrl,
          mediaType: image.mediaType,
        })),
      ],
    }

    const baseMessages = innerResult?.messages ?? options.messages
    return { messages: [...baseMessages, imageMessage] }
  }
