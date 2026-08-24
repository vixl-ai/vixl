import type { GrepMatch } from '@/services/vixl/vixl-tauri'
import type { SearchReplaceOptions } from '@/types/workbench/search-replace-options'
import { applyReplaceAt } from './apply-replace'
import readReplaceTarget from './read-replace-target'
import writeReplaceTarget from './write-replace-target'

export default async (args: {
  projectRoot: string
  find: string
  replace: string
  options: SearchReplaceOptions
  hit: GrepMatch
}): Promise<{ count: number }> => {
  const content = await readReplaceTarget({
    projectRoot: args.projectRoot,
    path: args.hit.path,
  })
  const result = applyReplaceAt(
    content,
    args.find,
    args.replace,
    args.options,
    {
      lineNumber: args.hit.lineNumber,
      startColumn: args.hit.startColumn,
      endColumn: args.hit.endColumn,
    },
  )
  if (result.count === 0 || result.content === content) {
    return { count: 0 }
  }
  await writeReplaceTarget({
    projectRoot: args.projectRoot,
    path: args.hit.path,
    content: result.content,
  })
  return { count: result.count }
}
