import { afterEach, describe, expect, it, vi } from 'vitest'
import imageCompression from 'browser-image-compression'
import bytesToDataUrl from '@/utils/bytes-to-data-url'
import normalizeImageDataUrl from '@/utils/normalize-image-data-url'

vi.mock('browser-image-compression', () => ({
  default: vi.fn<(file: File, options?: Record<string, unknown>) => Promise<File>>(),
}))

const PNG_DATA_URL = 'data:image/png;base64,AAAA'
const WEBP_DATA_URL = 'data:image/webp;base64,AAAA'
const JPEG_DATA_URL = 'data:image/jpeg;base64,AAAA'

const stubFetchFile = (size: number, type: string): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      blob: async () => new Blob([new Uint8Array(size)], { type }),
    })),
  )
}

const stubImageBitmap = (width: number, height: number): void => {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({
      width,
      height,
      close: vi.fn<() => void>(),
    })),
  )
}

describe('normalize-image-data-url', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.mocked(imageCompression).mockReset()
  })

  it('returns input unchanged for non-image mediaType', async () => {
    const input = {
      dataUrl: 'data:text/plain;base64,QQ==',
      mediaType: 'text/plain',
    }
    await expect(normalizeImageDataUrl(input)).resolves.toEqual(input)
    expect(imageCompression).not.toHaveBeenCalled()
  })

  it('returns input unchanged for a non-data URL', async () => {
    const input = {
      dataUrl: 'https://example.com/shot.png',
      mediaType: 'image/png',
    }
    await expect(normalizeImageDataUrl(input)).resolves.toEqual(input)
    expect(imageCompression).not.toHaveBeenCalled()
  })

  it('returns png/jpeg input unchanged when size and dimensions are within limits', async () => {
    stubFetchFile(1024, 'image/png')
    stubImageBitmap(800, 600)

    const input = { dataUrl: PNG_DATA_URL, mediaType: 'image/png' }
    await expect(normalizeImageDataUrl(input)).resolves.toEqual(input)
    expect(imageCompression).not.toHaveBeenCalled()

    stubFetchFile(2048, 'image/jpeg')
    stubImageBitmap(2000, 2000)
    const jpeg = { dataUrl: JPEG_DATA_URL, mediaType: 'image/jpeg' }
    await expect(normalizeImageDataUrl(jpeg)).resolves.toEqual(jpeg)
    expect(imageCompression).not.toHaveBeenCalled()
  })

  it('calls the library for an oversize png and returns its output', async () => {
    stubFetchFile(4 * 1024 * 1024, 'image/png')
    stubImageBitmap(800, 600)

    const compressedBytes = new Uint8Array([1, 2, 3, 4])
    const compressed = new File([compressedBytes], 'out.png', {
      type: 'image/jpeg',
    })
    vi.mocked(imageCompression).mockResolvedValue(compressed)

    const result = await normalizeImageDataUrl({
      dataUrl: PNG_DATA_URL,
      mediaType: 'image/png',
    })

    expect(imageCompression).toHaveBeenCalledTimes(1)
    expect(vi.mocked(imageCompression).mock.calls[0]?.[1]).toMatchObject({
      maxSizeMB: 3.75,
      maxWidthOrHeight: 2000,
      initialQuality: 0.8,
      useWebWorker: true,
      fileType: undefined,
    })
    expect(result).toEqual({
      dataUrl: bytesToDataUrl(compressedBytes, 'image/jpeg'),
      mediaType: 'image/jpeg',
    })
  })

  it('forces fileType image/png for webp input', async () => {
    stubFetchFile(512, 'image/webp')
    stubImageBitmap(100, 100)

    const compressedBytes = new Uint8Array([9, 8, 7])
    const compressed = new File([compressedBytes], 'out.png', {
      type: 'image/png',
    })
    vi.mocked(imageCompression).mockResolvedValue(compressed)

    const result = await normalizeImageDataUrl({
      dataUrl: WEBP_DATA_URL,
      mediaType: 'image/webp',
    })

    expect(vi.mocked(imageCompression).mock.calls[0]?.[1]).toMatchObject({
      fileType: 'image/png',
    })
    expect(result).toEqual({
      dataUrl: bytesToDataUrl(compressedBytes, 'image/png'),
      mediaType: 'image/png',
    })
  })

  it('falls through to the library when createImageBitmap throws for a small png', async () => {
    stubFetchFile(1024, 'image/png')
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('decode failed')
      }),
    )

    const compressedBytes = new Uint8Array([5, 6])
    const compressed = new File([compressedBytes], 'out.png', {
      type: 'image/png',
    })
    vi.mocked(imageCompression).mockResolvedValue(compressed)

    const result = await normalizeImageDataUrl({
      dataUrl: PNG_DATA_URL,
      mediaType: 'image/png',
    })

    expect(imageCompression).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      dataUrl: bytesToDataUrl(compressedBytes, 'image/png'),
      mediaType: 'image/png',
    })
  })

  it('returns the original input when the library throws', async () => {
    stubFetchFile(4 * 1024 * 1024, 'image/png')
    stubImageBitmap(800, 600)
    vi.mocked(imageCompression).mockRejectedValue(new Error('compress failed'))

    const input = { dataUrl: PNG_DATA_URL, mediaType: 'image/png' }
    await expect(normalizeImageDataUrl(input)).resolves.toEqual(input)
  })
})
