import type { StagedImage } from '@/types/harness/staged-image'

const byTurn = new Map<string, StagedImage[]>()

const turnKey = (chatId: string, turnId: string): string => `${chatId}\0${turnId}`

const imageStageStore = {
  get: (chatId: string, turnId: string): StagedImage[] =>
    byTurn.get(turnKey(chatId, turnId)) ?? [],
  set: (chatId: string, turnId: string, images: StagedImage[]): void => {
    byTurn.set(turnKey(chatId, turnId), images)
  },
  delete: (chatId: string, turnId: string): void => {
    byTurn.delete(turnKey(chatId, turnId))
  },
  reset: (): void => {
    byTurn.clear()
  },
}

export default imageStageStore
