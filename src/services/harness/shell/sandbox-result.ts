export type SandboxNetworkPolicy = 'deny' | 'allow'

export type SandboxResultMeta = {
  sandboxed: boolean
  network: SandboxNetworkPolicy
}

const hasSandboxingFooter = (text: string): boolean => text.includes('SANDBOXING:')

export const resolveSandboxResultMeta = (args: {
  sandboxed?: boolean
  allowNetwork?: boolean
}): SandboxResultMeta => {
  const sandboxed = args.sandboxed !== false
  if (!sandboxed) {
    return { sandboxed: false, network: 'allow' }
  }
  return {
    sandboxed: true,
    network: args.allowNetwork ? 'allow' : 'deny',
  }
}

export const sandboxingFooter = (meta: SandboxResultMeta): string => {
  if (!meta.sandboxed) {
    return [
      'SANDBOXING: This command ran outside the sandbox.',
      '- Filesystem and devices: not jailed',
      '- Network: allow',
    ].join('\n')
  }

  return [
    'SANDBOXING: This command ran in a sandbox with the following restrictions:',
    '- Filesystem: writes limited to the project; devices are isolated (no /dev/disk)',
    `- Network: ${meta.network}`,
    'If this failed due to the jail, the user will get a Run outside sandbox prompt. Do not retry the same sandboxed command. Do not write a .py workaround.',
  ].join('\n')
}

export const attachSandboxResult = (
  result: Record<string, unknown>,
  meta: SandboxResultMeta,
): Record<string, unknown> => ({
  ...result,
  sandboxed: meta.sandboxed,
  network: meta.network,
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
