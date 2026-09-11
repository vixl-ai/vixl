import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearStagedImages,
  drainStagedImages,
  resetImageStageForTests,
  stageImage,
} from '@/services/harness/image-stage'

const normalizeImageDataUrl = vi.hoisted(() =>
  vi.fn<
    (args: { dataUrl: string; mediaType: string }) => Promise<{
      dataUrl: string
      mediaType: string
    }>
  >(async (args) => ({
    dataUrl: `normalized:${args.dataUrl}`,
    mediaType: `normalized/${args.mediaType}`,
  })),
)

vi.mock('@/utils/normalize-image-data-url', () => ({
  default: (
    args: { dataUrl: string; mediaType: string },
  ): Promise<{ dataUrl: string; mediaType: string }> =>
    normalizeImageDataUrl(args),
}))

describe('image-stage registry', () => {
  beforeEach(() => {
    resetImageStageForTests()
    normalizeImageDataUrl.mockClear()
  })

  it('normalizes each image before storing', async () => {
    await stageImage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      image: {
        dataUrl: 'data:image/png;base64,aaaa',
        mediaType: 'image/png',
        source: 'shot.png',
      },
    })

    expect(normalizeImageDataUrl).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,aaaa',
      mediaType: 'image/png',
    })
    expect(drainStagedImages({ chatId: 'chat-1', turnId: 'turn-1' })).toEqual([
      {
        dataUrl: 'normalized:data:image/png;base64,aaaa',
        mediaType: 'normalized/image/png',
        source: 'shot.png',
      },
    ])
  })

  it('drain returns staged images and empties the turn', async () => {
    await stageImage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      image: {
        dataUrl: 'data:image/png;base64,one',
        mediaType: 'image/png',
        source: 'a.png',
      },
    })
    await stageImage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      image: {
        dataUrl: 'data:image/png;base64,bbbb',
        mediaType: 'image/png',
        source: 'b.png',
      },
    })

    const first = drainStagedImages({ chatId: 'chat-1', turnId: 'turn-1' })
    expect(first).toHaveLength(2)
    expect(drainStagedImages({ chatId: 'chat-1', turnId: 'turn-1' })).toEqual([])
  })

  it('clear empties the turn without returning images', async () => {
    await stageImage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      image: {
        dataUrl: 'data:image/png;base64,aaaa',
        mediaType: 'image/png',
        source: 'a.png',
      },
    })

    clearStagedImages({ chatId: 'chat-1', turnId: 'turn-1' })
    expect(drainStagedImages({ chatId: 'chat-1', turnId: 'turn-1' })).toEqual([])
  })

  it('keys isolate chat and turn pairs', async () => {
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
      turnId: 'turn-2',
      image: {
        dataUrl: 'data:image/png;base64,bbbb',
        mediaType: 'image/png',
        source: 'b.png',
      },
    })
    await stageImage({
      chatId: 'chat-2',
      turnId: 'turn-1',
      image: {
        dataUrl: 'data:image/png;base64,cccc',
        mediaType: 'image/png',
        source: 'c.png',
      },
    })

    expect(drainStagedImages({ chatId: 'chat-1', turnId: 'turn-1' })).toEqual([
      {
        dataUrl: 'normalized:data:image/png;base64,aaaa',
        mediaType: 'normalized/image/png',
        source: 'a.png',
      },
    ])
    expect(drainStagedImages({ chatId: 'chat-1', turnId: 'turn-2' })).toEqual([
      {
        dataUrl: 'normalized:data:image/png;base64,bbbb',
        mediaType: 'normalized/image/png',
        source: 'b.png',
      },
    ])
    expect(drainStagedImages({ chatId: 'chat-2', turnId: 'turn-1' })).toEqual([
      {
        dataUrl: 'normalized:data:image/png;base64,cccc',
        mediaType: 'normalized/image/png',
        source: 'c.png',
      },
    ])
  })
})
