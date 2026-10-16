import { beforeEach, describe, expect, it, vi } from 'vitest'
import bytesToDataUrl from '@/utils/bytes-to-data-url'
import assertImageBytes from '@/services/harness/image-stage/assert-image-bytes'
import {
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
  >(async (args) => args),
)

vi.mock('@/utils/normalize-image-data-url', () => ({
  default: (
    args: { dataUrl: string; mediaType: string },
  ): Promise<{ dataUrl: string; mediaType: string }> =>
    normalizeImageDataUrl(args),
}))

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])

describe('assertImageBytes', () => {
  it('accepts a PNG signature', () => {
    expect(() =>
      assertImageBytes({
        dataUrl: bytesToDataUrl(pngBytes, 'image/png'),
        mediaType: 'image/png',
        source: 'ok.png',
      }),
    ).not.toThrow()
  })

  it('accepts a JPEG SOI prefix', () => {
    expect(() =>
      assertImageBytes({
        dataUrl: bytesToDataUrl(jpegBytes, 'image/jpeg'),
        mediaType: 'image/jpeg',
        source: 'ok.jpg',
      }),
    ).not.toThrow()
  })

  it('leaves other image types to normalize', () => {
    expect(() =>
      assertImageBytes({
        dataUrl: bytesToDataUrl(gifBytes, 'image/gif'),
        mediaType: 'image/gif',
        source: 'ok.gif',
      }),
    ).not.toThrow()
  })

  it('rejects PNG bytes that lack the signature', () => {
    expect(() =>
      assertImageBytes({
        dataUrl: 'data:image/png;base64,aaaa',
        mediaType: 'image/png',
        source: 'bad.png',
      }),
    ).toThrow('Failed to stage image from bad.png: content is not a valid PNG')
  })

  it('rejects JPEG bytes that lack FFD8', () => {
    expect(() =>
      assertImageBytes({
        dataUrl: 'data:image/jpeg;base64,aaaa',
        mediaType: 'image/jpeg',
        source: 'bad.jpg',
      }),
    ).toThrow(
      'Failed to stage image from bad.jpg: content is not a valid JPEG',
    )
  })

  it('wraps malformed data URLs with the source path', () => {
    expect(() =>
      assertImageBytes({
        dataUrl: 'data:image/png;base64,!!!',
        mediaType: 'image/png',
        source: 'broken.png',
      }),
    ).toThrow('Failed to stage image from broken.png: Invalid base64')
  })
})

describe('stageImage signature check', () => {
  beforeEach(() => {
    resetImageStageForTests()
    normalizeImageDataUrl.mockClear()
  })

  it('does not normalize or store invalid PNG bytes', async () => {
    await expect(
      stageImage({
        chatId: 'chat-1',
        turnId: 'turn-1',
        image: {
          dataUrl: 'data:image/png;base64,aaaa',
          mediaType: 'image/png',
          source: 'shot.png',
        },
      }),
    ).rejects.toThrow(
      'Failed to stage image from shot.png: content is not a valid PNG',
    )
    expect(normalizeImageDataUrl).not.toHaveBeenCalled()
    expect(drainStagedImages({ chatId: 'chat-1', turnId: 'turn-1' })).toEqual([])
  })

  it('normalizes a structurally valid PNG', async () => {
    const dataUrl = bytesToDataUrl(pngBytes, 'image/png')
    await stageImage({
      chatId: 'chat-1',
      turnId: 'turn-1',
      image: {
        dataUrl,
        mediaType: 'image/png',
        source: 'shot.png',
      },
    })
    expect(normalizeImageDataUrl).toHaveBeenCalledWith({
      dataUrl,
      mediaType: 'image/png',
    })
  })
})
