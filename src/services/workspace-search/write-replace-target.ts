import { fsWriteFile } from '@/services/vixl/vixl-tauri'
import getWorkingModel from './get-working-model'

export default async (args: {
  projectRoot: string
  path: string
  content: string
}): Promise<'model' | 'disk'> => {
  const model = getWorkingModel(args.path)
  if (model) {
    if (model.getValue() !== args.content) {
      model.setValue(args.content)
    }
    return 'model'
  }
  await fsWriteFile({
    projectRoot: args.projectRoot,
    path: args.path,
    content: args.content,
  })
  return 'disk'
}
