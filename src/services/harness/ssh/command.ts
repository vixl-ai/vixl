const SEGMENT_SPLIT = /(?:&&|\|\||[;\n|&])+/
const TOKEN_SPLIT = /\s+/

const unwrapQuotes = (token: string): string => {
  if (token.length < 2) {
    return token
  }
  const start = token[0]
  const end = token[token.length - 1]
  if ((start === '"' && end === '"') || (start === "'" && end === "'")) {
    return token.slice(1, -1)
  }
  return token
}

const tokenCommand = (token: string): string => {
  const raw = unwrapQuotes(token)
  const sep = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'))
  return sep === -1 ? raw : raw.slice(sep + 1)
}

const isEnvAssignment = (token: string): boolean =>
  /^[A-Za-z_][A-Za-z0-9_]*=/.test(token)

export type CommandTokens = {
  name: string
  tokens: string[]
  rest: string
}

export const firstCommandTokens = (segment: string): CommandTokens | null => {
  const tokens = segment.trim().split(TOKEN_SPLIT).filter(Boolean)
  let start = 0
  while (start < tokens.length && isEnvAssignment(tokens[start] ?? '')) {
    start += 1
  }
  const rest = tokens.slice(start)
  const first = rest[0]
  if (!first) {
    return null
  }
  return {
    name: tokenCommand(first),
    tokens: rest,
    rest: rest.slice(1).join(' '),
  }
}

export const commandSegments = (command: string): string[] =>
  command.split(SEGMENT_SPLIT).map((segment) => segment.trim()).filter(Boolean)

const SSH_BINARIES = new Set(['ssh', 'scp', 'sftp'])

export const commandLooksLikeSsh = (command: string): boolean =>
  commandSegments(command).some((segment) => {
    const parsed = firstCommandTokens(segment)
    return parsed !== null && SSH_BINARIES.has(parsed.name)
  })

export const commandLooksLikeSudo = (command: string): boolean =>
  commandSegments(command).some((segment) => {
    const parsed = firstCommandTokens(segment)
    return parsed?.name === 'sudo'
  })

const sshTokensLookLikePortForward = (tokens: string[]): boolean => {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token) {
      continue
    }
    if (token === '-L' || token === '-R' || token === '-D' || token === '-W') {
      return true
    }
    if (
      token.startsWith('-L') ||
      token.startsWith('-R') ||
      token.startsWith('-D')
    ) {
      return token.length === 2 || token[2] === '=' || /^-?[LRD]/.test(token)
    }
    if (token === '-o' || token.startsWith('-o')) {
      const value =
        token === '-o' ? (tokens[i + 1] ?? '') : token.slice(token.startsWith('-o=') ? 3 : 2)
      const lower = value.toLowerCase()
      if (
        lower.includes('tunnel=') ||
        lower.includes('localforward') ||
        lower.includes('remoteforward') ||
        lower.includes('dynamicforward') ||
        lower.includes('gatewayports')
      ) {
        return true
      }
    }
  }
  return false
}

export const commandLooksLikePortForward = (command: string): boolean =>
  commandSegments(command).some((segment) => {
    const parsed = firstCommandTokens(segment)
    if (!parsed || parsed.name !== 'ssh') {
      return false
    }
    return sshTokensLookLikePortForward(parsed.tokens)
  })

export type NamedRefusalKind =
  | 'x11'
  | 'tun'
  | 'agent'
  | 'browser'
  | 'daemon'
  | 'wsl'
  | 'devcontainers'
  | 'sshfs'

const sshFlagValue = (tokens: string[], index: number, token: string): string => {
  if (token === '-o') {
    return tokens[index + 1] ?? ''
  }
  if (token.startsWith('-o')) {
    return token.slice(token.startsWith('-o=') ? 3 : 2)
  }
  return ''
}

const sshNamedRefusal = (tokens: string[]): NamedRefusalKind | null => {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (!token) {
      continue
    }
    if (token === '-X' || token === '-Y') {
      return 'x11'
    }
    if (token === '-A') {
      return 'agent'
    }
    if (token === '-w' || token.startsWith('-w')) {
      return 'tun'
    }
    const option = sshFlagValue(tokens, i, token).toLowerCase()
    if (!option) {
      continue
    }
    if (option.includes('forwardx11')) {
      return 'x11'
    }
    if (option.includes('forwardagent')) {
      return 'agent'
    }
    if (option.startsWith('tunnel=') && !option.includes('tunnel=no')) {
      return 'tun'
    }
  }
  return null
}

const segmentNamedRefusal = (segment: string): NamedRefusalKind | null => {
  const parsed = firstCommandTokens(segment)
  if (!parsed) {
    return null
  }
  if (parsed.name === 'ssh' || parsed.name === 'scp' || parsed.name === 'sftp') {
    return sshNamedRefusal(parsed.tokens)
  }
  if (parsed.name === 'sshfs') {
    return 'sshfs'
  }
  if (parsed.name === 'wsl' || parsed.name === 'wsl.exe') {
    return 'wsl'
  }
  if (parsed.name === 'devcontainer' || parsed.name === 'devcontainer.exe') {
    return 'devcontainers'
  }
  const joined = parsed.tokens.join(' ').toLowerCase()
  if (
    parsed.name === 'code' &&
    (joined.includes('--folder-uri vscode-remote://wsl') || joined.includes('wsl+'))
  ) {
    return 'wsl'
  }
  if (
    /\b(vixl[- ]?daemon|install(?:ing)? a (?:vixl )?daemon)\b/.test(joined) ||
    (parsed.name === 'vixl' && joined.includes('daemon'))
  ) {
    return 'daemon'
  }
  if (
    parsed.name === 'google-chrome' ||
    parsed.name === 'chromium' ||
    parsed.name === 'firefox' ||
    parsed.name === 'msedge' ||
    parsed.name === 'browser'
  ) {
    return 'browser'
  }
  return null
}

export const commandNamedRefusal = (command: string): NamedRefusalKind | null => {
  for (const segment of commandSegments(command)) {
    const kind = segmentNamedRefusal(segment)
    if (kind) {
      return kind
    }
  }
  return null
}
