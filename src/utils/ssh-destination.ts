export type SshDestinationError = {
  title: string
  body: string
}

export const looksLikeSshCommand = (value: string): boolean => {
  const trimmed = value.trim()
  return (
    trimmed === 'ssh' ||
    trimmed.startsWith('ssh ') ||
    trimmed.startsWith('ssh\t') ||
    trimmed.startsWith('/usr/bin/ssh')
  )
}

export const looksLikePasswordInHost = (value: string): boolean => {
  const rest = value.replace(/^ssh:\/\//i, '')
  const credentials = rest.split('@')[0]
  if (!credentials || credentials.startsWith('[')) {
    return false
  }
  return credentials.includes(':')
}

export const validateSshDestination = (raw: string): SshDestinationError | null => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return {
      title: 'Enter a host.',
      body: 'Type an alias such as appleseed, or a user and host such as johnny@appleseed.example.',
    }
  }
  if (looksLikeSshCommand(trimmed)) {
    return {
      title: 'That is an ssh command, not a host.',
      body: 'Vixl connects to a host such as appleseed.example. Flags in this field are not applied. Set the port and the identity file in the fields below. The next screen shows the settings OpenSSH will use.',
    }
  }
  if (looksLikePasswordInHost(trimmed)) {
    return {
      title: 'Remove the password from the host field.',
      body: 'Vixl will not connect with a password in the host. Type appleseed, or johnny@appleseed.example, and enter the password when asked.',
    }
  }
  return null
}

export const hostIncludesUser = (raw: string): boolean => {
  const trimmed = raw.trim().replace(/^ssh:\/\//i, '')
  const at = trimmed.lastIndexOf('@')
  if (at <= 0) {
    return false
  }
  const user = trimmed.slice(0, at)
  return user.length > 0 && !user.includes(' ') && !user.includes(':')
}

export const validateSshUser = (host: string, user: string): SshDestinationError | null => {
  if (user.trim() || hostIncludesUser(host)) {
    return null
  }
  return {
    title: 'Enter a user.',
    body: 'Type the account on that host, such as johnny. Vixl does not use the account on this computer.',
  }
}

export const sshIdentityExample = (platform: string = navigator.platform): string => {
  if (/win/i.test(platform)) {
    return 'C:\\Users\\johnny\\.ssh\\id_ed25519'
  }
  if (/linux/i.test(platform)) {
    return '/home/johnny/.ssh/id_ed25519'
  }
  return '/Users/johnny/.ssh/id_ed25519'
}

export const validateSshPort = (raw: string): SshDestinationError | null => {
  const trimmed = raw.trim()
  if (!trimmed) {
    return null
  }
  if (!/^\d+$/.test(trimmed)) {
    return {
      title: 'Port is not valid.',
      body: 'Use a number from 1 to 65535.',
    }
  }
  const port = Number(trimmed)
  if (port < 1 || port > 65535) {
    return {
      title: 'Port is not valid.',
      body: 'Use a number from 1 to 65535.',
    }
  }
  return null
}

export const parseSshConnectError = (error: unknown): SshDestinationError => {
  const message = error instanceof Error ? error.message : String(error)
  const idx = message.indexOf('\n')
  if (idx === -1) {
    return { title: message || 'Could not connect.', body: '' }
  }
  return {
    title: message.slice(0, idx),
    body: message.slice(idx + 1),
  }
}

export type SshConnectRequest = {
  destination: string
  user?: string
  port?: number
  identityFile?: string
  passwordOnly?: boolean
}

export const buildSshConnectRequest = (args: {
  destination: string
  user?: string
  port?: number
  identityFile?: string
  passwordOnly?: boolean
}): SshConnectRequest => {
  const request: SshConnectRequest = {
    destination: args.destination,
  }
  const user = args.user?.trim()
  if (user) {
    request.user = user
  }
  if (args.port && args.port !== 0) {
    request.port = args.port
  }
  const identityFile = args.identityFile?.trim()
  if (identityFile) {
    request.identityFile = identityFile
  }
  if (args.passwordOnly) {
    request.passwordOnly = true
  }
  return request
}
