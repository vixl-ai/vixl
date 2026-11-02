import { call } from './helpers'

export type SshPreview = {
  destination: string
  user: string
  hostname: string
  port: number
  identityFiles: string[]
  identitiesOnly: boolean
  sawMatch: boolean
  confirmBody: string
}

export type SshErrorCopy = {
  title: string
  body: string
}

export type SshSessionStatus = {
  user: string
  hostname: string
  port: number
  destination: string
  state: string
  line: string
  lastError: SshErrorCopy | null
  masterAlive: boolean
}

export type SshConnectRequest = {
  destination: string
  user?: string
  port?: number
  identityFile?: string
  passwordOnly?: boolean
}

export type SshConfirmEvent = {
  requestId: string
  hostname: string
  port: number
  fingerprint?: string | null
  keyType?: string | null
  prompt: string
  address?: string | null
}

export type SshSecretKind = 'passphrase' | 'password' | 'otp' | 'pin' | 'other'

export type SshSecretEvent = {
  requestId: string
  hostname: string
  port: number
  prompt: string
  kind: SshSecretKind
  saveable: boolean
}

export type SshBannerEvent = {
  hostname: string
  port: number
  text: string
}

export type SshStatusEvent = {
  user: string
  hostname: string
  port: number
  line: string
}

export type SshErrorEvent = {
  hostname: string
  port: number
  title: string
  body: string
}

export type SshSavedIdentity = {
  kind: string
  identity: string
}

export type SshExecResult = {
  stdout: string
  stderr: string
  exitCode: number
  hostname: string
}

export const sshListAliases = (configFile?: string): Promise<string[]> =>
  call('ssh_list_aliases', configFile ? { configFile } : {})

export const sshPreview = (args: {
  destination: string
  port?: number
  identityFile?: string
}): Promise<SshPreview> => call('ssh_preview', args)

export const sshConnect = (request: SshConnectRequest): Promise<SshSessionStatus> =>
  call('ssh_connect', { request })

export const sshDisconnect = (user: string, hostname: string, port: number): Promise<SshSessionStatus> =>
  call('ssh_disconnect', { user, hostname, port })

export const sshSessionStatus = (
  user: string,
  hostname: string,
  port: number,
): Promise<SshSessionStatus> => call('ssh_session_status', { user, hostname, port })

export const sshListSessions = (): Promise<SshSessionStatus[]> => call('ssh_list_sessions')

export const sshCancelConnect = (user: string, hostname: string, port: number): Promise<void> =>
  call('ssh_cancel_connect', { user, hostname, port })

export const sshExec = (args: {
  user: string
  hostname: string
  port: number
  command: string
}): Promise<SshExecResult> => call('ssh_exec', args)

export const sshAnswerConfirm = (
  requestId: string,
  trusted: boolean,
  alsoAdd: boolean,
): Promise<void> => call('ssh_answer_confirm', { requestId, trusted, alsoAdd })

export const sshAnswerSecret = (requestId: string, value: string): Promise<void> =>
  call('ssh_answer_secret', { requestId, value })

export const sshCancelPrompt = (requestId: string): Promise<void> =>
  call('ssh_cancel_prompt', { requestId })

export const sshRemoveVixlHostKey = (hostname: string, port: number): Promise<number> =>
  call('ssh_remove_vixl_host_key', { hostname, port })

export const sshSavePassword = (
  user: string,
  hostname: string,
  port: number,
  value: string,
): Promise<void> => call('ssh_save_password', { user, hostname, port, value })

export const sshDeletePassword = (user: string, hostname: string, port: number): Promise<void> =>
  call('ssh_delete_password', { user, hostname, port })

export const sshSavePassphrase = (keyPath: string, value: string): Promise<void> =>
  call('ssh_save_passphrase', { keyPath, value })

export const sshDeletePassphrase = (keyPath: string): Promise<void> =>
  call('ssh_delete_passphrase', { keyPath })

export const sshListSavedIdentities = (): Promise<SshSavedIdentity[]> =>
  call('ssh_list_saved_identities')

export const sshOpenLocalForward = (args: {
  user: string
  hostname: string
  port: number
  bindAddress: string
  localPort: number
  remoteHost: string
  remotePort: number
}): Promise<void> => call('ssh_open_local_forward', args)
