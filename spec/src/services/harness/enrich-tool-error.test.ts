import { describe, expect, it } from 'vitest'
import enrichToolError from '@/services/harness/enrich-tool-error'

describe('enrich-tool-error', () => {
  it('adds hint for unrecognized patch header', () => {
    const result = enrichToolError('Unrecognized patch header: --- a/src/main.ts')
    expect(result).toContain('OpenCode format')
  })

  it('returns original message when no hint matches', () => {
    const result = enrichToolError('Something unexpected happened')
    expect(result).toBe('Something unexpected happened')
  })

  it('does not prefer edit_file on SANDBOX_ jail errors', () => {
    const result = enrichToolError(
      'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (isolated devices). Isolated /dev has no block devices. Command failed (exit 1): lsblk not available',
    )
    expect(result).not.toContain('edit_file')
  })

  it('does not attach edit_file when the SANDBOXING footer is present', () => {
    const result = enrichToolError(
      'Command failed (exit 1): operation not permitted\n\nSANDBOXING: If this failed due to the jail, the user will get a Run outside sandbox prompt.',
    )
    expect(result).not.toContain('edit_file')
  })

  it('does not prefer edit_file on generic command failed', () => {
    const result = enrichToolError('Command failed (exit 1): No such file')
    expect(result).not.toContain('edit_file')
    expect(result).toContain('SANDBOXING footer')
  })
})
