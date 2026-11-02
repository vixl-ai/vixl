import { isSshProjectRoot } from '@/utils/ssh-project-root'
import {
  approvalDeniedError,
  commitSigningError,
  disconnectedToolError,
  forcedCommandError,
  gitHookWaitingError,
  maxSessionsError,
  mcpUntrustedHostError,
  openingRootError,
  partialWriteError,
  pathEscapeError,
  planWriteError,
  rgMissingError,
  sessionDroppedError,
  sshHostFromRoot,
  sudoNoTtyError,
  terminalGoneError,
  workspaceTrustError,
} from '@/services/harness/ssh/model-errors'

const asMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const lower = (value: string): string => value.toLowerCase()

export const looksLikeSessionDropped = (message: string): boolean => {
  const text = lower(message)
  return (
    text.includes('master is dead') ||
    text.includes('is not connected') ||
    text.includes('stopped responding') ||
    text.includes('connection reset') ||
    text.includes('broken pipe') ||
    text.includes('connection lost') ||
    text.includes('control socket') ||
    (text.includes('dropped') && text.includes('ssh'))
  )
}

export const looksLikeDisconnect = (message: string): boolean => {
  const text = lower(message)
  return text.includes('disconnected from') || text.startsWith('disconnected')
}

export const looksLikeMaxSessions = (message: string): boolean =>
  /maxsessions/i.test(message) || /too many.*session/i.test(message)

export const looksLikeForcedCommand = (message: string): boolean =>
  /forced command/i.test(message) || /authorized_keys instead of a shell/i.test(message)

export const looksLikeSudoNoTty = (message: string): boolean => {
  const text = lower(message)
  return (
    (text.includes('sudo') && (text.includes('no tty') || text.includes('a terminal is required'))) ||
    text.includes('sudo: no tty') ||
    (text.includes('password') && text.includes('no tty'))
  )
}

export const looksLikeRgMissing = (message: string): boolean =>
  /(^|\b)rg is not installed\b/i.test(message) || /ripgrep \(rg\) is not installed/i.test(message)

export const looksLikePathEscape = (message: string): boolean =>
  /path escapes project root/i.test(message) ||
  /path must be relative to the project root/i.test(message) ||
  /path traversal is not allowed/i.test(message)

export const looksLikeOpeningRoot = (message: string, commandOrPath?: string): boolean => {
  if (/opening \/ on /i.test(message) && /refused/i.test(message)) {
    return true
  }
  if (commandOrPath?.trim() === '/' && looksLikePathEscape(message)) {
    return true
  }
  return message.includes('"/" was not opened')
}

export const looksLikeUnreachable = (message: string): boolean =>
  /is unreachable/i.test(message)

export const isUnreachableHostError = (error: unknown): boolean =>
  looksLikeUnreachable(asMessage(error))

export const catchUnlessUnreachable = async <T>(
  load: () => Promise<T>,
  fallback: T,
): Promise<T> => {
  try {
    return await load()
  } catch (error) {
    if (isUnreachableHostError(error)) {
      throw error
    }
    return fallback
  }
}

const alreadyMapped = (message: string): boolean =>
  message.includes('Do not retry this on this Mac') ||
  message.includes('Do not retry on this Mac') ||
  message.includes('was not retried on this Mac') ||
  message.includes('Do not attempt this on this Mac') ||
  message.includes('Do not search this Mac instead') ||
  message.includes('Do not open a local shell instead') ||
  message.includes('Do not run it on this Mac') ||
  message.includes('Do not copy it to this Mac') ||
  message.includes('Do not read this Mac') ||
  message.includes('Do not forward ports on this Mac') ||
  message.includes('Do not ask for a password in chat') ||
  message.includes('Do not write the plan on this Mac') ||
  message.includes('Do not commit on this Mac') ||
  message.includes('Nothing was written on this Mac') ||
  message.includes('Do not call it on this Mac instead') ||
  message.includes('Workspace trust for') ||
  message.includes('The SSH master was left running') ||
  message.includes('Do not paste a passphrase in chat')

export const looksLikePartialWrite = (message: string): boolean =>
  /size on .+ does not match the bytes sent/i.test(message) ||
  /stopped early/i.test(message) ||
  /partial write/i.test(message)

export const looksLikeGitHook = (message: string): boolean => {
  const text = lower(message)
  return (
    (text.includes('hook') &&
      (text.includes('waiting') ||
        text.includes('needs a terminal') ||
        text.includes('no tty') ||
        text.includes('not a tty'))) ||
    text.includes('error: githook')
  )
}

export const looksLikeCommitSigning = (message: string): boolean => {
  const text = lower(message)
  return (
    text.includes('gpg failed') ||
    text.includes('signing failed') ||
    text.includes('secret key') ||
    text.includes('user.signingkey') ||
    (text.includes('sign') && text.includes('passphrase'))
  )
}

export const looksLikeMcpUntrusted = (message: string): boolean =>
  /is not trusted yet/i.test(message) || /is not trusted for /i.test(message)

export const looksLikeLspTrust = (message: string, installState?: string): boolean =>
  installState === 'needs_trust' ||
  /needs trust/i.test(message) ||
  /^lsp unavailable$/i.test(message.trim())

export const looksLikeTerminalGone = (message: string): boolean =>
  /shell not found/i.test(message) || /already gone/i.test(message)

export const mapSshToolError = (
  projectRoot: string,
  error: unknown,
  extras?: {
    path?: string
    command?: string
    toolName?: string
    serverId?: string
    installState?: string
    fromThrow?: boolean
  },
): string => {
  const host = sshHostFromRoot(projectRoot)
  const message = asMessage(error)
  if (!isSshProjectRoot(projectRoot)) {
    return message
  }
  if (alreadyMapped(message)) {
    return message
  }
  if (looksLikeOpeningRoot(message, extras?.path ?? extras?.command)) {
    return openingRootError(host)
  }
  if (looksLikePathEscape(message)) {
    const leadIn = message.split('\n')[0]?.trim() || 'Path escapes project root'
    return pathEscapeError(leadIn.replace(/\.$/, ''), host)
  }
  if (looksLikeRgMissing(message)) {
    return rgMissingError(host)
  }
  if (looksLikeMaxSessions(message)) {
    return maxSessionsError(host)
  }
  if (looksLikeForcedCommand(message)) {
    return forcedCommandError(host)
  }
  if (looksLikeSudoNoTty(message)) {
    return sudoNoTtyError(host)
  }
  if (looksLikePartialWrite(message)) {
    return partialWriteError(extras?.path || '(path)', host)
  }
  if (looksLikeGitHook(message)) {
    return gitHookWaitingError(host)
  }
  if (looksLikeCommitSigning(message)) {
    return commitSigningError(host)
  }
  if (looksLikeMcpUntrusted(message)) {
    const serverId = extras?.serverId || 'unknown'
    return mcpUntrustedHostError(serverId, host)
  }
  if (looksLikeLspTrust(message, extras?.installState)) {
    return workspaceTrustError(host)
  }
  if (
    extras?.toolName === 'stop_terminal' &&
    looksLikeTerminalGone(message)
  ) {
    return terminalGoneError(host)
  }
  if (looksLikeDisconnect(message) && !looksLikeSessionDropped(message)) {
    return disconnectedToolError(host)
  }
  if (looksLikeSessionDropped(message) || looksLikeUnreachable(message)) {
    return sessionDroppedError(host)
  }
  if (
    extras?.fromThrow &&
    (extras?.toolName === 'create_plan' ||
      extras?.toolName === 'update_plan' ||
      extras?.toolName === 'update_plan_todo')
  ) {
    return planWriteError(host)
  }
  return message
}

export const mapSshDenied = (
  projectRoot: string,
  leadIn: string,
  options?: { sensitive?: boolean },
): string => {
  if (!isSshProjectRoot(projectRoot)) {
    return leadIn
  }
  const host = sshHostFromRoot(projectRoot)
  if (options?.sensitive) {
    return `${leadIn}. The sensitive path was not read or written on ${host}. Do not copy it to this Mac.`
  }
  return approvalDeniedError(leadIn.replace(/\.$/, ''), host)
}
