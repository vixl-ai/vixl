import type { FileUIPart } from 'ai'
import filenameWithMediaTypeExtension from '@/utils/filename-with-media-type-extension'
import normalizeImageDataUrl from '@/utils/normalize-image-data-url'

export default async (files: FileUIPart[]): Promise<FileUIPart[]> => {
  const next: FileUIPart[] = []

  for (const file of files) {
    const url = file.url
    const mediaType = file.mediaType || 'image/png'
    if (
      !url ||
      url.startsWith('file://') ||
      !url.startsWith('data:') ||
      !mediaType.startsWith('image/')
    ) {
      next.push(file)
      continue
    }

    const normalized = await normalizeImageDataUrl({
      dataUrl: url,
      mediaType,
    })
    let filename = file.filename
    if (normalized.mediaType !== mediaType) {
      filename = filenameWithMediaTypeExtension(filename, normalized.mediaType)
    }
    next.push({
      ...file,
      mediaType: normalized.mediaType,
      url: normalized.dataUrl,
      filename,
    })
  }

  return next
}
