// Seatbelt read denies do not always surface as EPERM. Some tools report a
// hidden path as missing instead, for example ssh-keygen loading a denied
// ~/.ssh pubkey prints "No such file or directory". This extractor pulls the
// absolute paths out of ENOENT-shaped error lines that sit outside the project
// root. The caller probes each candidate against the unsandboxed host: a path
// the sandboxed child called missing that exists on the host is a masked
// denial, not a genuinely missing file.
const ENOENT_LINE = /No such file or directory|ENOENT/i

const underProjectRoot = (path: string, projectRoot: string | undefined): boolean => {
  if (!projectRoot) {
    return false
  }
  const root = projectRoot.replace(/\/+$/, '') || '/'
  if (root === '/') {
    return true
  }
  return path === root || path.startsWith(`${root}/`)
}

const maskedEnoentCandidates = (
  text: string,
  projectRoot: string | undefined,
): string[] => {
  const candidates: string[] = []
  for (const line of text.split('\n')) {
    if (!ENOENT_LINE.test(line)) {
      continue
    }
    for (const match of line.matchAll(/\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)+/g)) {
      const candidate = match[0].replace(/\.+$/, '')
      if (candidate.length > 1 && !underProjectRoot(candidate, projectRoot)) {
        candidates.push(candidate)
      }
    }
  }
  return [...new Set(candidates)]
}

export default maskedEnoentCandidates