import {
  commandLooksLikePortForward,
  commandNamedRefusal,
} from '@/services/harness/ssh/command'
import {
  namedRefusalError,
  namedRefusalSentences,
  portForwardModelError,
  readOnlySubagentError,
  sshHostFromRoot,
} from '@/services/harness/ssh/model-errors'
import { sshRunsAsLineFromRoot } from '@/utils/ssh-project-root'

const remoteRejected = (
  projectRoot: string,
  error: string,
  extra?: Record<string, unknown>,
): Record<string, unknown> => ({
  rejected: true,
  error,
  remote: true,
  cwd: projectRoot,
  runsAt: sshRunsAsLineFromRoot(projectRoot) ?? undefined,
  ...extra,
})

export const sshRunTerminalGuard = (
  projectRoot: string,
  command: string,
  readOnly: boolean,
  cwdSlug?: string,
): Record<string, unknown> | null => {
  const slug = cwdSlug ? { cwdSlug } : {}
  if (readOnly) {
    return remoteRejected(projectRoot, readOnlySubagentError(sshHostFromRoot(projectRoot)), slug)
  }
  if (commandLooksLikePortForward(command)) {
    return remoteRejected(projectRoot, portForwardModelError(sshHostFromRoot(projectRoot)), {
      command,
    })
  }
  const refusal = commandNamedRefusal(command)
  if (refusal) {
    const sentences = namedRefusalSentences(sshHostFromRoot(projectRoot))
    return remoteRejected(projectRoot, namedRefusalError(sentences[refusal]), { command })
  }
  return null
}
