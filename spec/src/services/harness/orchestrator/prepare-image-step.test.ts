import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelMessage } from 'ai'
import {
  resetImageStageForTests,
  stageImage,
} from '@/services/harness/image-stage'
import prepareImageStep from '@/services/harness/orchestrator/prepare-image-step'

const normalizeImageDataUrl = vi.hoisted(() =>
  vi.fn<
    (args: { dataUrl: string; mediaType: string }) => Promise<{
      dataUrl: string
      mediaType: string
    }>
  >(async (args) => args),
)

vi.mock('@/utils/normalize-image-data-url', () => ({
  default: (
    args: { dataUrl: string; mediaType: string },
  ): Promise<{ dataUrl: string; mediaType: string }> =>
    normalizeImageDataUrl(args),
}))

const originalMessages: ModelMessage[] = [
  { role: 'user', content: 'look at this' },
]

const compactedMessages: ModelMessage[] = [
  { role: 'user', content: 'compacted' },
]

describe('prepare-image-step', () => {
  beforeEach(() => {
    resetImageStageForTests()
    normalizeImageDataUrl.mockImplementation(async (args) => args)
  })

  it('passes through inner undefined when the stage is empty', async () => {
    const inner = vi.fn<(options: { messages: ModelMessage[] }) => Promise<undefined>>(
      async () => undefined,
    )
    const prepareStep = prepareImageStep({
      chatId: 'chat-1',
      turnId: 'turn-1',
      inner,
    })

    await expect(prepareStep({ messages: originalMessages })).resolves.toBeUndefined()
    expect(inner).toHaveBeenCalledWith({ messages: originalMessages })
  })

  it('passes through inner messages when the stage is empty', async () => {
    const inner = vi.fn<
      (options: { messages: ModelMessage[] }) => Promise<{ messages: ModelMessage[] }>
    >(async () => ({ messages: compactedMessages }))
    const prepareStep = prepareImageStep({
      chatId: 'chat-1',
      turnId: 'turn-1',
      inner,
    })

    await expect(prepareStep({ messages: originalMessages })).resolves.toEqual({
      messages: compactedMessages,
    })
  })

  it('appends a synthetic user file message when inner returns undefined', async () => {
    await stageImage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      image: {
        dataUrl: 'data:image/png;base64,aaaa',
        mediaType: 'image/png',
        source: 'a.png',
      },
    })
    await stageImage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      image: {
        dataUrl: 'data:image/jpeg;base64,bbbb',
        mediaType: 'image/jpeg',
        source: 'b.jpg',
      },
    })

    const inner = vi.fn<(options: { messages: ModelMessage[] }) => Promise<undefined>>(
      async () => undefined,
    )
    const prepareStep = prepareImageStep({
      chatId: 'chat-1',
      turnId: 'turn-1',
      inner,
    })

    const result = await prepareStep({ messages: originalMessages })
    expect(result).toEqual({
      messages: [
        ...originalMessages,
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Images loaded by tools (sources: a.png, b.jpg):',
            },
            {
              type: 'file',
              data: 'data:image/png;base64,aaaa',
              mediaType: 'image/png',
            },
            {
              type: 'file',
              data: 'data:image/jpeg;base64,bbbb',
              mediaType: 'image/jpeg',
            },
          ],
        },
      ],
    })
  })

  it('appends a synthetic user file message onto compacted messages', async () => {
    await stageImage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      image: {
        dataUrl: 'data:image/png;base64,aaaa',
        mediaType: 'image/png',
        source: 'shot.png',
      },
    })

    const inner = vi.fn<
      (options: { messages: ModelMessage[] }) => Promise<{ messages: ModelMessage[] }>
    >(async () => ({ messages: compactedMessages }))
    const prepareStep = prepareImageStep({
      chatId: 'chat-1',
      turnId: 'turn-1',
      inner,
    })

    const result = await prepareStep({ messages: originalMessages })
    expect(result).toEqual({
      messages: [
        ...compactedMessages,
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Images loaded by tools (sources: shot.png):',
            },
            {
              type: 'file',
              data: 'data:image/png;base64,aaaa',
              mediaType: 'image/png',
            },
          ],
        },
      ],
    })
  })
})
