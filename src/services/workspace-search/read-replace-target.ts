import { fsReadFile } from '@/services/vixl/vixl-tauri'
import getWorkingModel from './get-working-model'

export default async (args: {
  projectRoot: string
  path: string
}): Promise<string> => {
  const model = getWorkingModel(args.path)
  if (model) {
    return model.getValue()
  }
  const result = await fsReadFile({
    projectRoot: args.projectRoot,
    path: args.path,
  })
  return result.content
}
