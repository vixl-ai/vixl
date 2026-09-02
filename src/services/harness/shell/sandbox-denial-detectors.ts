type SandboxRuntimeDenialKind = 'filesystem' | 'network' | 'devices'

type DetectSandboxRuntimeDenialOptions = {
  command?: string
  projectRoot?: string
  sandboxed?: boolean
  allowNetwork?: boolean
}

const isBlankOutput = (text: string): boolean => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== '.' && line !== '..')
  return lines.length === 0
}

const isLsblkHeaderOnly = (text: string): boolean => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) {
    return false
  }
  const header = lines[0]
  if (!header || !/^NAME(\s|$)/.test(header) || !header.includes('MAJ:MIN')) {
    return false
  }
  return lines.slice(1).every((line) => !/\b(disk|part)\b/i.test(line))
}

const isSsHeaderOnly = (text: string): boolean => {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) {
    return false
  }
  const header = lines[0]
  if (
    !header ||
    !/\bRecv-Q\b/i.test(header) ||
    !/\bSend-Q\b/i.test(header) ||
    !/Local Address:Port/i.test(header)
  ) {
    return false
  }
  return lines.slice(1).every((line) => !/\b(?:LISTEN|UNCONN)\b/i.test(line))
}

const commandLooksLikeSs = (command: string): boolean =>
  /\bss\b/.test(command) && /(?:^|\s)-(?:tlnp|tln|ltnp|ln)(?:\s|$)/.test(command)

const commandLooksLikeDeviceProbe = (command: string): boolean =>
  /\blsblk\b/.test(command) ||
  /\/dev\/disk\b/.test(command) ||
  /\/sys\/block\b/.test(command) ||
  /by-uuid/.test(command)

const hasMissingLsblk = (text: string): boolean =>
  /lsblk\s+not\s+available/i.test(text) ||
  /missing\s+lsblk/i.test(text) ||
  /lsblk:.*not found/i.test(text) ||
  /command not found:\s*lsblk/i.test(text) ||
  /lsblk:\s*command not found/i.test(text)

const hasBwrapTmpfsFingerprint = (text: string): boolean =>
  /tmpfs\[\/newroot\]/i.test(text) ||
  /tmpfs on \/dev\b/i.test(text) ||
  /\/dev\s+type\s+tmpfs/i.test(text) ||
  (/tmpfs/.test(text) && /\/newroot/.test(text))

const hasMissingDeviceTree = (text: string): boolean => {
  const missing = /No such file or directory|ENOENT/i.test(text)
  if (!missing) {
    return false
  }
  return (
    /\/dev\/disk/.test(text) ||
    /\/sys\/block/.test(text) ||
    /['`]\/dev['`]/.test(text) ||
    /(?:^|[\s:])\/dev(?:[:\s]|$)/m.test(text)
  )
}

const hasEmptyByUuidProbe = (text: string): boolean =>
  /by-uuid/.test(text) &&
  (/No such file or directory/i.test(text) ||
    /cannot access/i.test(text) ||
    /empty/i.test(text))

const commandLooksLikeNetwork = (command: string): boolean =>
  /\bcurl\b/.test(command) ||
  /\bwget\b/.test(command) ||
  /https?:\/\//i.test(command) ||
  /\blocalhost\b/i.test(command) ||
  /\b127\.0\.0\.1\b/.test(command) ||
  /:8096\b/.test(command)

const hasNetworkFallbackOutput = (text: string): boolean =>
  /JSON-tool failed/i.test(text) ||
  /Jellyfin not on localhost/i.test(text) ||
  /not available/i.test(text)

const detectSilentNetwork = (
  text: string,
  command: string | undefined,
): boolean => {
  if (!command || !commandLooksLikeNetwork(command)) {
    return false
  }
  return isBlankOutput(text) || hasNetworkFallbackOutput(text)
}

const commandLooksLikeCurlOrWget = (
  text: string,
  command: string | undefined,
): boolean =>
  (command !== undefined && (/\bcurl\b/.test(command) || /\bwget\b/.test(command))) ||
  /\bcurl:\s*\(\d+\)/.test(text) ||
  /\bwget:/i.test(text)

const hasSandboxedConnectFail = (
  text: string,
  command: string | undefined,
): boolean => {
  const fromCommand =
    command !== undefined &&
    (/\bcurl\b/.test(command) ||
      /\bwget\b/.test(command) ||
      commandLooksLikeNetwork(command))
  if (!fromCommand && !commandLooksLikeCurlOrWget(text, command)) {
    return false
  }
  return (
    /Failed to connect/i.test(text) ||
    /curl:\s*\(7\)/.test(text) ||
    /Connection refused/i.test(text)
  )
}

const hasNpmRegistryNetworkFailure = (text: string): boolean =>
  text.includes('getaddrinfo ENOTFOUND') ||
  /npm error audit endpoint returned an error/i.test(text) ||
  /audit request to https:\/\//i.test(text) ||
  /npm error network/i.test(text)

const detectEmptySs = (text: string, command: string | undefined): boolean => {
  if (isSsHeaderOnly(text)) {
    return true
  }
  return Boolean(command && commandLooksLikeSs(command) && isBlankOutput(text))
}

const isSandboxedContext = (options?: DetectSandboxRuntimeDenialOptions): boolean =>
  options?.sandboxed !== false

const isNetworkDeniedSandbox = (
  options?: DetectSandboxRuntimeDenialOptions,
): boolean => isSandboxedContext(options) && options?.allowNetwork !== true

const OUT_OF_WORKSPACE_ROOTS = ['/srv', '/mnt', '/media', '/opt'] as const

const normalizePosixPath = (value: string): string => {
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed.length > 0 ? trimmed : '/'
}

const isUnderProjectRoot = (path: string, projectRoot: string | undefined): boolean => {
  if (!projectRoot) {
    return false
  }
  const root = normalizePosixPath(projectRoot)
  const abs = normalizePosixPath(path)
  if (root === '/') {
    return true
  }
  return abs === root || abs.startsWith(`${root}/`)
}

const extractOutsideCandidatePaths = (text: string): string[] => {
  const paths: string[] = []
  const startRe = /\/(?:srv|mnt|media|opt)(?=\/|[^A-Za-z0-9_-]|$)/gi
  for (const match of text.matchAll(startRe)) {
    const start = match.index ?? 0
    const rest = text.slice(start)
    const full = rest.match(/^\/[^\s"'`;|&<>]+/)?.[0] ?? match[0]
    const candidate = full.replace(/[,.:]+$/, '')
    const rooted = OUT_OF_WORKSPACE_ROOTS.some(
      (root) => candidate === root || candidate.startsWith(`${root}/`),
    )
    if (rooted) {
      paths.push(candidate)
    }
  }
  return paths
}

const hasOutOfWorkspaceTarget = (
  command: string | undefined,
  output: string,
  projectRoot: string | undefined,
): boolean => {
  const haystack = `${command ?? ''}\n${output}`
  return extractOutsideCandidatePaths(haystack).some(
    (path) => !isUnderProjectRoot(path, projectRoot),
  )
}

const detectOutOfWorkspaceProbe = (
  text: string,
  command: string | undefined,
  projectRoot: string | undefined,
): boolean => {
  if (!hasOutOfWorkspaceTarget(command, text, projectRoot)) {
    return false
  }
  if (/No such file or directory|ENOENT/i.test(text)) {
    return true
  }
  if (command && /\b(?:find|ls)\b/.test(command) && isBlankOutput(text)) {
    return true
  }
  return false
}

const detectDeviceIsolation = (
  text: string,
  command: string | undefined,
): boolean => {
  if (hasMissingLsblk(text)) {
    return true
  }
  if (hasBwrapTmpfsFingerprint(text)) {
    return true
  }
  if (hasMissingDeviceTree(text)) {
    return true
  }
  if (hasEmptyByUuidProbe(text)) {
    return true
  }
  if (isLsblkHeaderOnly(text)) {
    return true
  }
  if (command && commandLooksLikeDeviceProbe(command) && isBlankOutput(text)) {
    return true
  }
  return false
}

/** Detect Seatbelt / bwrap runtime denials from command output (not spawn failures). */
const detectSandboxRuntimeDenial = (
  combinedOutput: string,
  options?: DetectSandboxRuntimeDenialOptions,
): SandboxRuntimeDenialKind | null => {
  const text = combinedOutput

  const hasNodeLstatEperm =
    text.includes('EPERM') &&
    text.includes('operation not permitted') &&
    text.includes('lstat')
  const hasGenericOperationNotPermitted = text.includes('Operation not permitted')
  if (hasNodeLstatEperm || hasGenericOperationNotPermitted) {
    return 'filesystem'
  }

  const hasNetworkConnect = /error connecting to\s+\S+/i.test(text)
  const hasCouldNotResolve = text.includes('Could not resolve host')
  const hasNetworkUnreachable = text.includes('Network is unreachable')
  if (hasNetworkConnect || hasCouldNotResolve || hasNetworkUnreachable) {
    return 'network'
  }

  if (detectSilentNetwork(text, options?.command)) {
    return 'network'
  }

  if (detectEmptySs(text, options?.command)) {
    return 'network'
  }

  if (
    isSandboxedContext(options) &&
    hasSandboxedConnectFail(text, options?.command)
  ) {
    return 'network'
  }

  if (isNetworkDeniedSandbox(options) && hasNpmRegistryNetworkFailure(text)) {
    return 'network'
  }

  if (detectDeviceIsolation(text, options?.command)) {
    return 'devices'
  }

  if (detectOutOfWorkspaceProbe(text, options?.command, options?.projectRoot)) {
    return 'filesystem'
  }

  return null
}

export { detectSandboxRuntimeDenial }

export type { DetectSandboxRuntimeDenialOptions, SandboxRuntimeDenialKind }
