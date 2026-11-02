import { restoreFailedError, sshHostFromRoot } from '@/services/harness/ssh/model-errors'
import { fileCheckpointLoad, fsDelete, fsWriteFile } from '@/services/vixl/vixl-tauri'
import type {
  FileCheckpointRestoreResult,
  FileCheckpointRestoreTarget,
} from '@/types/harness/file-checkpoint'

type RestoreTargetGroup = {
  projectRoot: string
  targets: FileCheckpointRestoreTarget[]
  originalPaths: string[]
}

const emptyRestoreResult = (): FileCheckpointRestoreResult => ({
  restored: [],
  deleted: [],
  skipped: [],
  errors: [],
})

export const restoreSshCheckpointGroup = async (args: {
  projectSlug: string
  chatId: string
  group: RestoreTargetGroup
}): Promise<FileCheckpointRestoreResult> => {
  const host = sshHostFromRoot(args.group.projectRoot)
  const result = emptyRestoreResult()
  for (let index = 0; index < args.group.targets.length; index += 1) {
    const target = args.group.targets[index]
    if (!target) {
      continue
    }
    const originalPath = args.group.originalPaths[index] ?? target.path
    try {
      const loaded = await fileCheckpointLoad({
        projectSlug: args.projectSlug,
        chatId: args.chatId,
        userMessageId: target.userMessageId,
        path: target.path,
        ...(target.key ? { key: target.key } : {}),
      })
      if (loaded.skipped) {
        result.skipped.push(originalPath)
        continue
      }
      if (!loaded.existed) {
        await fsDelete({
          projectRoot: args.group.projectRoot,
          path: target.path,
          allowSensitive: true,
        })
        result.deleted.push(originalPath)
        continue
      }
      await fsWriteFile({
        projectRoot: args.group.projectRoot,
        path: target.path,
        content: loaded.content ?? '',
        allowSensitive: true,
      })
      result.restored.push(originalPath)
    } catch {
      result.errors.push({
        path: originalPath,
        error: restoreFailedError(originalPath, host),
      })
    }
  }
  return result
}
