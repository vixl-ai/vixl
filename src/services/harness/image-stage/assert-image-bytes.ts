import dataUrlToBytes from '@/utils/data-url-to-bytes'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const JPEG_PREFIX = [0xff, 0xd8] as const

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean => {
  if (bytes.length < prefix.length) {
    return false
  }
  for (let i = 0; i < prefix.length; i += 1) {
    if (bytes[i] !== prefix[i]) {
      return false
    }
  }
  return true
}

const mediaKind = (mediaType: string): string =>
  (mediaType.split(';')[0] ?? '').trim().toLowerCase()

export default (args: {
  dataUrl: string
  mediaType: string
  source: string
}): void => {
  const kind = mediaKind(args.mediaType)
  if (kind !== 'image/png' && kind !== 'image/jpeg') {
    return
  }

  let bytes: Uint8Array
  try {
    bytes = dataUrlToBytes(args.dataUrl).bytes
  } catch (error) {
    const detail =
      error instanceof Error ? error.message : 'could not decode data URL'
    throw new Error(`Failed to stage image from ${args.source}: ${detail}`)
  }

  if (kind === 'image/png' && !startsWith(bytes, PNG_SIGNATURE)) {
    throw new Error(
      `Failed to stage image from ${args.source}: content is not a valid PNG`,
    )
  }

  if (kind === 'image/jpeg' && !startsWith(bytes, JPEG_PREFIX)) {
    throw new Error(
      `Failed to stage image from ${args.source}: content is not a valid JPEG`,
    )
  }
}
