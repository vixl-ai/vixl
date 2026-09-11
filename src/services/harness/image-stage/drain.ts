import type { StagedImage } from '@/types/harness/staged-image'
import imageStageStore from './store'

export default (args: { chatId: string; turnId: string }): StagedImage[] => {
  const images = imageStageStore.get(args.chatId, args.turnId)
  imageStageStore.delete(args.chatId, args.turnId)
  return images
}
