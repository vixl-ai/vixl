export type SshProjectRoot = {
  user: string
  hostname: string
  port: number
  remotePath: string
}

export const isSshProjectRoot = (value: string | null | undefined): boolean =>
  Boolean(value && value.trim().toLowerCase().startsWith('ssh://'))

export const parseSshProjectRoot = (value: string): SshProjectRoot => {
  const trimmed = value.trim()
  if (!trimmed.toLowerCase().startsWith('ssh://')) {
    throw new Error('SSH project root must start with ssh://')
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Invalid SSH project root')
  }
  if (url.password) {
    throw new Error('Vixl will not open an SSH project root that contains a password.')
  }
  const user = decodeURIComponent(url.username)
  if (!user) {
    throw new Error('SSH project root is missing a user.')
  }
  const hostname = url.hostname.replace(/^\[/, '').replace(/\]$/, '')
  if (!hostname) {
    throw new Error('SSH project root is missing a host.')
  }
  const port = url.port ? Number(url.port) : 22
  const remotePath = url.pathname || '/'
  if (remotePath === '/') {
    throw new Error(`Opening / on ${hostname} is refused.`)
  }
  return { user, hostname, port, remotePath }
}

export const tryParseSshProjectRoot = (value: string | null | undefined): SshProjectRoot | null => {
  if (!value || !isSshProjectRoot(value)) {
    return null
  }
  try {
    return parseSshProjectRoot(value)
  } catch {
    return null
  }
}

export const formatSshUri = (root: SshProjectRoot): string => {
  const host = root.hostname.includes(':') ? `[${root.hostname}]` : root.hostname
  const port = root.port === 22 ? '' : `:${root.port}`
  const path = root.remotePath.startsWith('/') ? root.remotePath : `/${root.remotePath}`
  return `ssh://${root.user}@${host}${port}${path}`
}

export const sshSidebarLabel = (root: SshProjectRoot): string =>
  `${root.user}@${root.hostname}:${root.remotePath}`

export const sshCopyRemotePath = (root: SshProjectRoot, relativePath: string): string => {
  const absolute =
    !relativePath || relativePath === '.'
      ? root.remotePath
      : `${root.remotePath.replace(/\/$/, '')}/${relativePath.replace(/^\/+/, '')}`
  return `${root.user}@${root.hostname}:${absolute}`
}

export const sshSessionKey = (user: string, hostname: string, port: number): string =>
  `${user}@${hostname}:${port}`

export const sshSessionKeyFromRoot = (root: SshProjectRoot): string =>
  sshSessionKey(root.user, root.hostname, root.port)

export const RUNS_ON_THIS_MAC = 'Runs on this Mac'

export const sshRunsAsLine = (root: SshProjectRoot): string =>
  `Runs as ${root.user} on ${root.hostname}`

export const parseSshRunsAsLine = (
  line: string,
): { user: string; hostname: string } | null => {
  const prefix = 'Runs as '
  if (!line.startsWith(prefix)) {
    return null
  }
  const rest = line.slice(prefix.length)
  const split = rest.lastIndexOf(' on ')
  if (split <= 0) {
    return null
  }
  const user = rest.slice(0, split)
  const hostname = rest.slice(split + 4)
  if (!user || !hostname || hostname.includes(' ')) {
    return null
  }
  return { user, hostname }
}

export const sshRunsAsLineFromRoot = (projectRoot: string | null | undefined): string | null => {
  const parsed = tryParseSshProjectRoot(projectRoot)
  return parsed ? sshRunsAsLine(parsed) : null
}

export const sshHostLabel = (projectRoot: string | null | undefined): string | null => {
  const parsed = tryParseSshProjectRoot(projectRoot)
  return parsed ? parsed.hostname : null
}

export const sshUserLabel = (projectRoot: string | null | undefined): string | null => {
  const parsed = tryParseSshProjectRoot(projectRoot)
  return parsed ? parsed.user : null
}
