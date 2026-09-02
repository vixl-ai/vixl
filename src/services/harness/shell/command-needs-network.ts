const NETWORK_BINARIES = new Set([
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'bun',
  'pip',
  'pip3',
  'cargo',
  'curl',
  'wget',
  'gh',
])

const GIT_NETWORK_SUBCOMMANDS = new Set([
  'clone',
  'fetch',
  'pull',
  'push',
  'ls-remote',
])

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

const isGitDirFlag = (token: string): boolean =>
  token === '-C' ||
  token === '-c' ||
  token.startsWith('--git-dir') ||
  token.startsWith('--work-tree')

const gitNeedsNetwork = (tokens: string[], gitIndex: number): boolean => {
  let i = gitIndex + 1
  while (i < tokens.length) {
    const token = tokens[i]
    if (token == null) {
      break
    }
    const sub = unwrapQuotes(token)
    if (isGitDirFlag(sub)) {
      i += sub.includes('=') ? 1 : 2
      continue
    }
    if (sub.startsWith('-')) {
      i += 1
      continue
    }
    return GIT_NETWORK_SUBCOMMANDS.has(sub)
  }
  return false
}

const segmentNeedsNetwork = (segment: string): boolean => {
  const tokens = segment.trim().split(TOKEN_SPLIT).filter(Boolean)
  let start = 0
  while (start < tokens.length && isEnvAssignment(tokens[start] ?? '')) {
    start += 1
  }
  const rest = tokens.slice(start)

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i]
    if (token == null) {
      continue
    }
    const name = tokenCommand(token)
    if (NETWORK_BINARIES.has(name)) {
      return true
    }
    if (name === 'git' && gitNeedsNetwork(rest, i)) {
      return true
    }
  }
  return false
}

const commandNeedsSandboxNetwork = (command: string): boolean => {
  if (command.includes('http://') || command.includes('https://')) {
    return true
  }
  return command.split(SEGMENT_SPLIT).some(segmentNeedsNetwork)
}

export default commandNeedsSandboxNetwork
