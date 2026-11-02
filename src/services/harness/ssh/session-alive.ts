import { sshHostFromRoot, subagentSessionDownError } from '@/services/harness/ssh/model-errors'
import { sshSessionStatus } from '@/services/vixl/vixl-tauri'
import { isSshProjectRoot, tryParseSshProjectRoot } from '@/utils/ssh-project-root'

export const sshMasterIsDead = async (projectRoot: string): Promise<boolean> => {
  const parsed = tryParseSshProjectRoot(projectRoot)
  if (!parsed) {
    return false
  }
  try {
    const status = await sshSessionStatus(parsed.user, parsed.hostname, parsed.port)
    return !status.masterAlive || status.state !== 'connected'
  } catch {
    return true
  }
}

export const throwIfSshSubagentSessionDown = async (projectRoot: string): Promise<void> => {
  if (isSshProjectRoot(projectRoot) && (await sshMasterIsDead(projectRoot))) {
    throw new Error(subagentSessionDownError(sshHostFromRoot(projectRoot)))
  }
}
