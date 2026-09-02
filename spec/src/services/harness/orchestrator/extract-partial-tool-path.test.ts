import { describe, expect, it } from 'vitest'
import extractPartialToolPath from '@/services/harness/orchestrator/extract-partial-tool-path'

describe('extractPartialToolPath', () => {
  it('returns a complete path from partial JSON', () => {
    const buffers = new Map<string, string>()
    expect(extractPartialToolPath(buffers, 'call-1', '{"path":"src/a.ts","con')).toBe(
      'src/a.ts',
    )
    expect(buffers.get('call-1')).toBe('{"path":"src/a.ts","con')
  })

  it('returns null while the path string is incomplete', () => {
    const buffers = new Map<string, string>()
    expect(extractPartialToolPath(buffers, 'call-1', '{"path":"src/a.')).toBeNull()
    expect(extractPartialToolPath(buffers, 'call-1', 'ts')).toBeNull()
    expect(extractPartialToolPath(buffers, 'call-1', '"}')).toBe('src/a.ts')
  })

  it('unescapes quotes in a complete path', () => {
    const buffers = new Map<string, string>()
    expect(
      extractPartialToolPath(buffers, 'call-1', '{"path":"dir\\"file.ts"}'),
    ).toBe('dir"file.ts')
  })

  it('reads a path after an earlier string field', () => {
    const buffers = new Map<string, string>()
    expect(
      extractPartialToolPath(
        buffers,
        'call-1',
        '{"content":"hello \\"path\\":\\"nope\\"","path":"real.ts"}',
      ),
    ).toBe('real.ts')
  })
})
