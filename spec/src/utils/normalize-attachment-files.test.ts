import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileUIPart } from 'ai'

const normalizeImageDataUrl = vi.hoisted(() =>
  vi.fn<(args: { dataUrl: string; mediaType: string }) => Promise<{
    dataUrl: string
    mediaType: string
  }>>(async (args) => args),
)

vi.mock('@/utils/normalize-image-data-url', () => ({
  default: (
    args: { dataUrl: string; mediaType: string },
  ) => normalizeImageDataUrl(args),
}))

import normalizeAttachmentFiles from '@/utils/normalize-attachment-files'

const pngFile = (overrides?: Partial<FileUIPart>): FileUIPart => ({
  type: 'file',
  mediaType: 'image/png',
  url: 'data:image/png;base64,AAA',
  filename: 'shot.png',
  ...overrides,
})

describe('normalizeAttachmentFiles', () => {
  beforeEach(() => {
    normalizeImageDataUrl.mockReset()
    normalizeImageDataUrl.mockImplementation(async (args) => args)
  })

  it('normalizes image data-url parts and rewrites the filename when the type changes', async () => {
    normalizeImageDataUrl.mockResolvedValueOnce({
      dataUrl: 'data:image/jpeg;base64,BBB',
      mediaType: 'image/jpeg',
    })

    const result = await normalizeAttachmentFiles([
      pngFile({
        mediaType: 'image/webp',
        url: 'data:image/webp;base64,AAA',
        filename: 'shot.webp',
      }),
    ])

    expect(normalizeImageDataUrl).toHaveBeenCalledWith({
      dataUrl: 'data:image/webp;base64,AAA',
      mediaType: 'image/webp',
    })
    expect(result).toEqual([
      {
        type: 'file',
        mediaType: 'image/jpeg',
        url: 'data:image/jpeg;base64,BBB',
        filename: 'shot.jpg',
      },
    ])
  })

  it('leaves non-image and file:// parts untouched', async () => {
    const files: FileUIPart[] = [
      {
        type: 'file',
        mediaType: 'application/pdf',
        url: 'data:application/pdf;base64,AAA',
        filename: 'notes.pdf',
      },
      {
        type: 'file',
        mediaType: 'image/png',
        url: 'file:///tmp/shot.png',
        filename: 'shot.png',
      },
    ]

    await expect(normalizeAttachmentFiles(files)).resolves.toEqual(files)
    expect(normalizeImageDataUrl).not.toHaveBeenCalled()
  })

  it('propagates a compressor failure so the composer submit can throw', async () => {
    normalizeImageDataUrl.mockRejectedValueOnce(
      new Error('Image could not be compressed under the 3.75MB provider limit'),
    )

    await expect(normalizeAttachmentFiles([pngFile()])).rejects.toThrow(
      'Image could not be compressed under the 3.75MB provider limit',
    )
  })
})
