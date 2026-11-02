import {
  sshDeletePassphrase,
  sshDeletePassword,
  sshListSavedIdentities,
  sshSavePassphrase,
  sshSavePassword,
  type SshSavedIdentity,
} from '@/services/vixl/vixl-tauri/ssh'

export type SshSavedSecretRow = {
  kind: 'password' | 'passphrase'
  identity: string
  label: string
}

const basename = (path: string): string => {
  const trimmed = path.replace(/[\\/]+$/, '')
  const parts = trimmed.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export const labelForSavedIdentity = (row: SshSavedIdentity): string => {
  if (row.kind === 'passphrase') {
    return `Passphrase for ${basename(row.identity)}`
  }
  return row.identity
}

export const listSavedSecretRows = async (): Promise<SshSavedSecretRow[]> => {
  const identities = await sshListSavedIdentities()
  return identities.map((row) => ({
    kind: row.kind === 'passphrase' ? 'passphrase' : 'password',
    identity: row.identity,
    label: labelForSavedIdentity(row),
  }))
}

export const replaceSavedPassword = async (
  user: string,
  hostname: string,
  port: number,
  value: string,
): Promise<void> => {
  await sshSavePassword(user, hostname, port, value)
}

export const removeSavedPassword = async (
  user: string,
  hostname: string,
  port: number,
): Promise<void> => {
  await sshDeletePassword(user, hostname, port)
}

export const replaceSavedPassphrase = async (keyPath: string, value: string): Promise<void> => {
  await sshSavePassphrase(keyPath, value)
}

export const removeSavedPassphrase = async (keyPath: string): Promise<void> => {
  await sshDeletePassphrase(keyPath)
}

export const parsePasswordIdentity = (
  identity: string,
): { user: string; hostname: string; port: number } | null => {
  const match = identity.match(/^(.*)@([^@]+):(\d+)$/)
  if (!match) {
    return null
  }
  return {
    user: match[1]!,
    hostname: match[2]!,
    port: Number(match[3]),
  }
}
