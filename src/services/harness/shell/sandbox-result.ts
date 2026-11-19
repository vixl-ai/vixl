export type SandboxNetworkPolicy = 'deny' | 'allow'

export type SandboxResultMeta = {
  sandboxed: boolean
  network: SandboxNetworkPolicy
  cwd?: string
  cwdSlug?: string
  background?: boolean
}

const sandboxBlockLine = (background: boolean | undefined): string => {
  if (background) {
    return 'A background run stays sandboxed for its whole life: a spawn failure here is not retried unsandboxed, so run the command again without is_background to get the approved unsandboxed retry. No workaround such as a .py script, in-repo temp dirs, TMPDIR redirects, or .gitignore edits.'
  }
  return 'On a sandbox spawn failure, the harness asks before retrying outside the sandbox; a runtime sandbox block is reported as the result, with no workaround such as a .py script, in-repo temp dirs, TMPDIR redirects, or .gitignore edits.'
}

const hasSandboxingFooter = (text: string): boolean => text.includes('SANDBOXING:')

export const resolveSandboxResultMeta = (args: {
  sandboxed?: boolean
  allowNetwork?: boolean
  cwd?: string
  cwdSlug?: string
  background?: boolean
}): SandboxResultMeta => {
  const sandboxed = args.sandboxed !== false
  const cwdFields = {
    ...(args.cwd ? { cwd: args.cwd } : {}),
    ...(args.cwdSlug ? { cwdSlug: args.cwdSlug } : {}),
    ...(args.background ? { background: true } : {}),
  }
  if (!sandboxed) {
    return { sandboxed: false, network: 'allow', ...cwdFields }
  }
  return {
    sandboxed: true,
    network: args.allowNetwork ? 'allow' : 'deny',
    ...cwdFields,
  }
}

const workingDirectoryLine = (meta: SandboxResultMeta): string | undefined => {
  if (!meta.cwd) {
    return undefined
  }
  if (meta.cwdSlug) {
    return `Working directory: ${meta.cwd} (${meta.cwdSlug})`
  }
  return `Working directory: ${meta.cwd}`
}

export const sandboxingFooter = (meta: SandboxResultMeta): string => {
  const cwdLine = workingDirectoryLine(meta)
  if (!meta.sandboxed) {
    const unsandboxed = 'SANDBOXING: ran unsandboxed. Network: allow'
    return cwdLine ? `${unsandboxed}\n${cwdLine}` : unsandboxed
  }

  const lines = [
    `SANDBOXING: writes limited to the project, devices isolated (no /dev/disk). Network: ${meta.network}`,
    sandboxBlockLine(meta.background),
  ]
  if (cwdLine) {
    lines.push(cwdLine)
  }
  return lines.join('\n')
}

export const attachSandboxResult = (
  result: Record<string, unknown>,
  meta: SandboxResultMeta,
): Record<string, unknown> => ({
  ...result,
  sandboxed: meta.sandboxed,
  network: meta.network,
  ...(meta.cwd ? { cwd: meta.cwd } : {}),
  ...(meta.cwdSlug ? { cwdSlug: meta.cwdSlug } : {}),
  sandboxing: sandboxingFooter(meta),
})

export const appendSandboxingFooter = (
  message: string,
  meta: SandboxResultMeta,
): string => {
  if (hasSandboxingFooter(message)) {
    return message
  }
  return `${message}\n\n${sandboxingFooter(meta)}`
}

export const wrapWithSandboxingFooter = (
  error: unknown,
  meta: SandboxResultMeta,
): Error => {
  const message = error instanceof Error ? error.message : String(error)
  const wrapped = new Error(appendSandboxingFooter(message, meta))
  if (error instanceof Error && error.cause !== undefined) {
    wrapped.cause = error.cause
  }
  return wrapped
}
