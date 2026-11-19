import { describe, expect, it } from 'vitest'
import {
  appendSandboxingFooter,
  attachSandboxResult,
  resolveSandboxResultMeta,
  sandboxingFooter,
} from '@/services/harness/shell/sandbox-result'

describe('sandbox-result', () => {
  it('defaults spawn to sandboxed with network deny', () => {
    expect(resolveSandboxResultMeta({})).toEqual({
      sandboxed: true,
      network: 'deny',
    })
  })

  it('reports network allow when unsandboxed even if allowNetwork is false', () => {
    expect(
      resolveSandboxResultMeta({ sandboxed: false, allowNetwork: false }),
    ).toEqual({ sandboxed: false, network: 'allow' })
  })

  it('tells the model the harness asks before an unsandboxed retry and to report runtime blocks without workarounds', () => {
    const footer = sandboxingFooter({ sandboxed: true, network: 'deny' })
    expect(footer.startsWith('SANDBOXING:')).toBe(true)
    expect(footer).toContain('Network: deny')
    expect(footer).toContain(
      'the harness asks before retrying outside the sandbox',
    )
    expect(footer).not.toContain('Run outside sandbox')
    expect(footer).toContain('reported as the result')
    expect(footer).toContain('.py script')
    expect(footer).toContain('in-repo temp dirs')
    expect(footer).toContain('TMPDIR redirects')
    expect(footer).toContain('.gitignore edits')
    expect(footer).not.toContain('required_permissions')
  })

  it('keeps background meta so the footer cannot promise a retry', () => {
    expect(
      resolveSandboxResultMeta({ sandboxed: true, allowNetwork: true, background: true }),
    ).toEqual({ sandboxed: true, network: 'allow', background: true })
  })

  it('tells the model a background block is never retried unsandboxed', () => {
    const footer = sandboxingFooter({ sandboxed: true, network: 'allow', background: true })
    expect(footer).toContain('A background run stays sandboxed for its whole life')
    expect(footer).toContain('run the command again without is_background')
    expect(footer).toContain('.gitignore edits')
    expect(footer).not.toContain('the harness retries outside the sandbox')
  })

  it('reports unsandboxed runs in one line', () => {
    expect(sandboxingFooter({ sandboxed: false, network: 'allow' })).toBe(
      'SANDBOXING: ran unsandboxed. Network: allow',
    )
  })

  it('appends the working directory and slug when provided', () => {
    expect(
      sandboxingFooter({
        sandboxed: false,
        network: 'allow',
        cwd: '/tmp/web',
        cwdSlug: 'web',
      }),
    ).toBe(
      'SANDBOXING: ran unsandboxed. Network: allow\nWorking directory: /tmp/web (web)',
    )
  })

  it('attaches structured fields and a footer string on success payloads', () => {
    const result = attachSandboxResult(
      { shellId: 'shell-1', exitCode: 0 },
      { sandboxed: true, network: 'allow' },
    )
    expect(result.sandboxed).toBe(true)
    expect(result.network).toBe('allow')
    expect(String(result.sandboxing)).toContain('Network: allow')
  })

  it('does not duplicate the footer on thrown messages', () => {
    const once = appendSandboxingFooter('Command failed', {
      sandboxed: true,
      network: 'deny',
    })
    const twice = appendSandboxingFooter(once, {
      sandboxed: true,
      network: 'deny',
    })
    expect(twice).toBe(once)
  })
})
