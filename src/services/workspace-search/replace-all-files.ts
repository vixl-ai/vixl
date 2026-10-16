import type { SearchFileGroup } from '@/types/workbench/search-file-group'
import type { SearchReplaceOptions } from '@/types/workbench/search-replace-options'
import replaceInFile from './replace-in-file'

export default async (args: {
  projectRoot: string
  groups: SearchFileGroup[]
  find: string
  replace: string
  options: SearchReplaceOptions
}): Promise<{ occurrenceCount: number; fileCount: number }> => {
  let occurrenceCount = 0
  let fileCount = 0

  for (const group of args.groups) {
    const result = await replaceInFile({
      projectRoot: group.projectRoot ?? args.projectRoot,
      path: group.path,
      find: args.find,
      replace: args.replace,
      options: args.options,
    })
    if (result.count > 0) {
      occurrenceCount += result.count
      fileCount += 1
    }
  }

  return { occurrenceCount, fileCount }
}
