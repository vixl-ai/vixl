import imageCompression from 'browser-image-compression'
import bytesToDataUrl from '@/utils/bytes-to-data-url'

// 3.75MB = 5MB base64 budget x 3/4. 2000px matches the Claude Code / OpenCode consensus.
const MAX_SIZE_MB = 3.75
const MAX_RAW_BYTES = MAX_SIZE_MB * 1024 * 1024
const MAX_EDGE_PX = 2000
const LOSSY_FILE_TYPE = 'image/jpeg'
const OVER_BUDGET_MESSAGE =
  'Image could not be compressed under the 3.75MB provider limit'

const isProviderAcceptedImageType = (mediaType: string): boolean =>
  mediaType === 'image/png' || mediaType === 'image/jpeg'

const fileFromDataUrl = async (
  dataUrl: string,
  mediaType: string,
): Promise<File> => {
  const response = await fetch(dataUrl)
  const blob = await response.blob()
  return new File([blob], 'image', { type: mediaType })
}

const withinDimensionLimit = async (blob: Blob): Promise<boolean | null> => {
  try {
    const bitmap = await createImageBitmap(blob)
    const within = bitmap.width <= MAX_EDGE_PX && bitmap.height <= MAX_EDGE_PX
    bitmap.close()
    return within
  } catch {
    return null
  }
}

const wrapNormalizeError = (error: unknown): Error => {
  const message = error instanceof Error ? error.message : 'Unknown error'
  return new Error(`Failed to normalize image for provider: ${message}`)
}

export default async (args: {
  dataUrl: string
  mediaType: string
}): Promise<{ dataUrl: string; mediaType: string }> => {
  const { dataUrl, mediaType } = args

  if (!mediaType.startsWith('image/') || !dataUrl.startsWith('data:')) {
    return args
  }

  let compressed: File
  try {
    const file = await fileFromDataUrl(dataUrl, mediaType)

    if (isProviderAcceptedImageType(mediaType) && file.size <= MAX_RAW_BYTES) {
      const dimensionsOk = await withinDimensionLimit(file)
      if (dimensionsOk === true) {
        return args
      }
    }

    compressed = await imageCompression(file, {
      maxSizeMB: MAX_SIZE_MB,
      maxWidthOrHeight: MAX_EDGE_PX,
      initialQuality: 0.8,
      useWebWorker: true,
      fileType: LOSSY_FILE_TYPE,
    })
  } catch (error) {
    throw wrapNormalizeError(error)
  }

  if (compressed.size > MAX_RAW_BYTES) {
    throw new Error(OVER_BUDGET_MESSAGE)
  }

  const bytes = new Uint8Array(await compressed.arrayBuffer())
  const resultType = compressed.type || LOSSY_FILE_TYPE

  return {
    dataUrl: bytesToDataUrl(bytes, resultType),
    mediaType: resultType,
  }
}
