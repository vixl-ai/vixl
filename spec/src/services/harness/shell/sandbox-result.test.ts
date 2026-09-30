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

  it('tells the model the harness retries unsandboxed and to report denials without workarounds', () => {
    const footer = sandboxingFooter({ sandboxed: true, network: 'deny' })
    expect(footer.startsWith('SANDBOXING:')).toBe(true)
    expect(footer).toContain('Network: deny')
    expect(footer).toContain(
      'the harness retries outside the sandbox when the user already approved this command',
    )
    expect(footer).not.toContain('Run outside sandbox')
    expect(footer).toContain('report the denial as the result')
    expect(footer).toContain('.py script')
    expect(footer).toContain('in-repo temp dirs')
    expect(footer).toContain('TMPDIR redirects')
    expect(footer).toContain('.gitignore edits')
    expect(footer).not.toContain('required_permissions')
  })

  it('reports unsandboxed runs in one line', () => {
    expect(sandboxingFooter({ sandboxed: false, network: 'allow' })).toBe(
      'SANDBOXING: ran unsandboxed. Network: allow',
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
