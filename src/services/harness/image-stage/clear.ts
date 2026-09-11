import imageStageStore from './store'

export default (args: { chatId: string; turnId: string }): void => {
  imageStageStore.delete(args.chatId, args.turnId)
}
