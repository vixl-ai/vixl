import type { StagedImage } from '@/types/harness/staged-image'
import normalizeImageDataUrl from '@/utils/normalize-image-data-url'
import imageStageStore from './store'

export default async (args: {
  chatId: string
  turnId: string
  image: StagedImage
}): Promise<void> => {
  const normalized = await normalizeImageDataUrl({
    dataUrl: args.image.dataUrl,
    mediaType: args.image.mediaType,
  })
  const existing = imageStageStore.get(args.chatId, args.turnId)
  imageStageStore.set(args.chatId, args.turnId, [
    ...existing,
    {
      dataUrl: normalized.dataUrl,
      mediaType: normalized.mediaType,
      source: args.image.source,
    },
  ])
}
