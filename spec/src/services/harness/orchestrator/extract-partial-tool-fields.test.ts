import { describe, expect, it } from 'vitest'
import extractPartialToolFields from '@/services/harness/orchestrator/extract-partial-tool-fields'

type Fields = {
  path?: string
  tool?: string
  description?: string
}

const parse = (json: string, toolCallId = 'call-1'): Fields | null =>
  extractPartialToolFields(new Map<string, string>(), toolCallId, json)

const feed = (
  deltas: string[],
  toolCallId = 'call-1',
  buffers = new Map<string, string>(),
): { result: Fields | null; buffers: Map<string, string> } => {
  let result: Fields | null = null
  for (const delta of deltas) {
    result = extractPartialToolFields(buffers, toolCallId, delta)
  }
  return { result, buffers }
}

const feedChars = (
  json: string,
  toolCallId = 'call-1',
  buffers = new Map<string, string>(),
): Array<Fields | null> => {
  const results: Array<Fields | null> = []
  for (const ch of json) {
    results.push(extractPartialToolFields(buffers, toolCallId, ch))
  }
  return results
}

describe('extractPartialToolFields', () => {
  describe('buffering', () => {
    it('returns a complete path from partial JSON and stores the delta', () => {
      const buffers = new Map<string, string>()
      expect(extractPartialToolFields(buffers, 'call-1', '{"path":"src/a.ts","con')).toEqual({
        path: 'src/a.ts',
      })
      expect(buffers.get('call-1')).toBe('{"path":"src/a.ts","con')
    })

    it('appends delta onto an empty first buffer', () => {
      const buffers = new Map<string, string>()
      expect(extractPartialToolFields(buffers, 'call-1', '{"path":"')).toBeNull()
      expect(buffers.get('call-1')).toBe('{"path":"')
    })

    it('appends delta even when the parse returns null', () => {
      const buffers = new Map<string, string>()
      expect(extractPartialToolFields(buffers, 'call-1', '{"path":"src/a.')).toBeNull()
      expect(buffers.get('call-1')).toBe('{"path":"src/a.')
      expect(extractPartialToolFields(buffers, 'call-1', 'ts')).toBeNull()
      expect(buffers.get('call-1')).toBe('{"path":"src/a.ts')
      expect(extractPartialToolFields(buffers, 'call-1', '"}')).toEqual({ path: 'src/a.ts' })
      expect(buffers.get('call-1')).toBe('{"path":"src/a.ts"}')
    })

    it('stays null until a write_file path string is fully closed, then returns path', () => {
      const payload = '{"path":"src/a.ts","content":"x"}'
      const buffers = new Map<string, string>()
      const results = feedChars(payload, 'call-1', buffers)
      const closerIndex = '{"path":"src/a.ts'.length
      expect(results[closerIndex - 1]).toBeNull()
      expect(results[closerIndex]).toEqual({ path: 'src/a.ts' })
      expect(results.at(-1)).toEqual({ path: 'src/a.ts' })
      expect(buffers.get('call-1')).toBe(payload)
    })

    it('stays null until an MCP tool string is fully closed, then returns tool', () => {
      const payload = '{"serverId":"brave","tool":"brave_web_search","args":{"query":"hi"}}'
      const buffers = new Map<string, string>()
      const results = feedChars(payload, 'call-1', buffers)
      const closerIndex = '{"serverId":"brave","tool":"brave_web_search'.length
      expect(results[closerIndex - 1]).toBeNull()
      expect(results[closerIndex]).toEqual({ tool: 'brave_web_search' })
      expect(results.at(-1)).toEqual({ tool: 'brave_web_search' })
      expect(buffers.get('call-1')).toBe(payload)
    })

    it('returns the completed field again on an empty delta', () => {
      const buffers = new Map<string, string>()
      expect(extractPartialToolFields(buffers, 'call-1', '{"path":"src/a.ts"}')).toEqual({
        path: 'src/a.ts',
      })
      expect(extractPartialToolFields(buffers, 'call-1', '')).toEqual({ path: 'src/a.ts' })
      expect(buffers.get('call-1')).toBe('{"path":"src/a.ts"}')
    })

    it('returns the completed field on later deltas and adds a newly completed sibling', () => {
      const buffers = new Map<string, string>()
      expect(extractPartialToolFields(buffers, 'call-1', '{"path":"src/a.ts","tool":"wri')).toEqual({
        path: 'src/a.ts',
      })
      expect(
        extractPartialToolFields(buffers, 'call-1', 'te_file"}'),
      ).toEqual({ path: 'src/a.ts', tool: 'write_file' })
    })

    it('extracts kebab-case tool names', () => {
      expect(parse('{"tool":"get-page"}')).toEqual({ tool: 'get-page' })
    })

    it('extracts snake_case tool names', () => {
      expect(parse('{"tool":"brave_web_search"}')).toEqual({ tool: 'brave_web_search' })
    })

    it('extracts unicode letters in tool and path values', () => {
      expect(parse('{"path":"café/naïve.ts","tool":"café_search"}')).toEqual({
        path: 'café/naïve.ts',
        tool: 'café_search',
      })
    })

    it('builds an emoji from two UTF-16 surrogate escapes', () => {
      const emoji = String.fromCharCode(0xd83d, 0xde00)
      expect(parse('{"tool":"\\uD83D\\uDE00"}')).toEqual({ tool: emoji })
      expect(parse('{"path":"\\uD83D\\uDE00.ts"}')).toEqual({ path: `${emoji}.ts` })
    })
  })

  describe('path', () => {
    it('returns a complete path from partial JSON', () => {
      expect(parse('{"path":"src/a.ts","con')).toEqual({ path: 'src/a.ts' })
    })

    it('reads a path after an earlier string field', () => {
      expect(
        parse('{"content":"hello \\"path\\":\\"nope\\"","path":"real.ts"}'),
      ).toEqual({ path: 'real.ts' })
    })

    it('returns path while a later incomplete key is still open', () => {
      expect(parse('{"path":"src/a.ts","too')).toEqual({ path: 'src/a.ts' })
    })

    describe('hold-path safety', () => {
      it('returns null while the path string is incomplete', () => {
        const { result, buffers } = feed(['{"path":"src/a.', 'ts'])
        expect(result).toBeNull()
        expect(extractPartialToolFields(buffers, 'call-1', '"}')).toEqual({ path: 'src/a.ts' })
      })

      it('returns null for an empty path string', () => {
        expect(parse('{"path":""}')).toBeNull()
      })

      it('does not treat a nested args path as a top-level path', () => {
        expect(parse('{"args":{"path":"nope"}}')).toBeNull()
        expect(parse('{"content":"x","args":{"path":"nope"}}')).toBeNull()
      })

      it('does not treat path text inside another string as a path key', () => {
        expect(parse('{"content":"hello \\"path\\":\\"nope\\""}')).toBeNull()
        expect(parse('{"note":"path is src/a.ts"}')).toBeNull()
      })
    })
  })

  describe('tool', () => {
    it('returns a complete tool from partial JSON', () => {
      expect(parse('{"serverId":"brave","tool":"brave_web_search","args":{')).toEqual({
        tool: 'brave_web_search',
      })
    })

    it('reads a tool after an earlier string field', () => {
      expect(parse('{"serverId":"shadcn","tool":"search_items"}')).toEqual({
        tool: 'search_items',
      })
    })

    describe('MCP tool safety', () => {
      it('returns null while the tool string is incomplete', () => {
        const { result, buffers } = feed(['{"tool":"brave_web_', 'search'])
        expect(result).toBeNull()
        expect(extractPartialToolFields(buffers, 'call-1', '"}')).toEqual({
          tool: 'brave_web_search',
        })
      })

      it('returns null for an empty tool string', () => {
        expect(parse('{"tool":""}')).toBeNull()
      })

      it('does not invent a top-level tool from a nested args tool', () => {
        expect(parse('{"args":{"tool":"fake"}}')).toBeNull()
        expect(parse('{"serverId":"brave","args":{"tool":"fake"}}')).toBeNull()
      })

      it('does not let a nested args tool override a real top-level tool', () => {
        expect(
          parse('{"tool":"get-page","args":{"path":"/docs","tool":"nested"}}'),
        ).toEqual({ tool: 'get-page' })
      })

      it('extracts only tool from a call_mcp_tool payload shape', () => {
        expect(
          parse('{"serverId":"brave","tool":"brave_web_search","args":{"query":"hi"}}'),
        ).toEqual({ tool: 'brave_web_search' })
      })
    })
  })

  describe('description', () => {
    it('returns a complete description from partial JSON while a later command string is still open', () => {
      expect(
        parse('{"description":"Polling CI status on remote","command":"gh pr checks'),
      ).toEqual({ description: 'Polling CI status on remote' })
    })

    it('stays null until the description string is fully closed, then returns description', () => {
      const payload = '{"description":"Polling CI status on remote","command":"gh pr checks"}'
      const buffers = new Map<string, string>()
      const results = feedChars(payload, 'call-1', buffers)
      const closerIndex = '{"description":"Polling CI status on remote'.length
      expect(results[closerIndex - 1]).toBeNull()
      expect(results[closerIndex]).toEqual({
        description: 'Polling CI status on remote',
      })
      expect(results.at(-1)).toEqual({
        description: 'Polling CI status on remote',
      })
      expect(buffers.get('call-1')).toBe(payload)
    })

    it('returns null for an empty description string', () => {
      expect(parse('{"description":""}')).toBeNull()
    })

    it('does not treat a nested description as a top-level description', () => {
      expect(parse('{"args":{"description":"nope"}}')).toBeNull()
      expect(parse('{"command":"x","args":{"description":"nope"}}')).toBeNull()
    })

    it('returns description and path when both top-level strings are complete', () => {
      expect(
        parse('{"description":"Write helper","path":"src/a.ts","content":"'),
      ).toEqual({
        description: 'Write helper',
        path: 'src/a.ts',
      })
    })
  })

  describe('both', () => {
    it('returns path and tool when both top-level strings are complete', () => {
      expect(parse('{"path":"src/a.ts","tool":"write_note","content":"')).toEqual({
        path: 'src/a.ts',
        tool: 'write_note',
      })
    })

    it('returns tool while a later path string is still incomplete', () => {
      expect(parse('{"tool":"search","path":"src/a.')).toEqual({ tool: 'search' })
    })

    it('returns path while a later tool string is still incomplete', () => {
      expect(parse('{"path":"src/a.ts","tool":"wri')).toEqual({ path: 'src/a.ts' })
    })

    it('returns both when they complete in either order', () => {
      expect(parse('{"tool":"search","path":"src/a.ts"}')).toEqual({
        path: 'src/a.ts',
        tool: 'search',
      })
      expect(parse('{"path":"src/a.ts","tool":"search"}')).toEqual({
        path: 'src/a.ts',
        tool: 'search',
      })
    })

    it('returns null when neither field is complete', () => {
      expect(parse('{"content":"hello"')).toBeNull()
      expect(parse('{')).toBeNull()
      expect(parse('')).toBeNull()
      expect(parse('{"path":"src/a.')).toBeNull()
      expect(parse('{"tool":"brav')).toBeNull()
    })

    it('does not scan past an unclosed first field even when later text looks like a sibling', () => {
      expect(parse('{"path":"src/a.ts later \\"tool\\":\\"search\\"')).toBeNull()
      expect(parse('{"path":"foo\\","tool":"search"}')).toEqual({
        path: 'foo",',
      })
    })
  })

  describe('escapes', () => {
    it('passes through a value with no escape sequences', () => {
      expect(parse('{"path":"src/plain-file.ts"}')).toEqual({
        path: 'src/plain-file.ts',
      })
    })

    it('unescapes quotes in a complete path', () => {
      expect(parse('{"path":"dir\\"file.ts"}')).toEqual({ path: 'dir"file.ts' })
    })

    it('unescapes quotes in a complete tool', () => {
      expect(parse('{"tool":"dir\\"tool"}')).toEqual({ tool: 'dir"tool' })
    })

    it('does not terminate a string on an escaped quote', () => {
      expect(parse('{"path":"dir\\"file.ts","tool":"write"}')).toEqual({
        path: 'dir"file.ts',
        tool: 'write',
      })
    })

    it('treats an escaped backslash as a real backslash before the closer', () => {
      expect(parse('{"path":"foo\\\\"}')).toEqual({ path: 'foo\\' })
      expect(parse('{"tool":"foo\\\\"}')).toEqual({ tool: 'foo\\' })
    })

    it('treats a dangling backslash before a closer as an incomplete string', () => {
      expect(parse('{"path":"foo\\"}')).toBeNull()
      expect(parse('{"tool":"foo\\"}')).toBeNull()
      expect(parse('{"tool":"done","path":"foo\\"}')).toEqual({ tool: 'done' })
    })

    it('completes after a dangling backslash once a non-quote escape arrives', () => {
      const { result, buffers } = feed(['{"path":"foo\\'])
      expect(result).toBeNull()
      expect(extractPartialToolFields(buffers, 'call-1', 'n"}')).toEqual({ path: 'foo\n' })
    })

    it('unescapes slash, newline, CR, and tab', () => {
      expect(parse('{"path":"a\\/b"}')).toEqual({ path: 'a/b' })
      expect(parse('{"path":"a\\nb"}')).toEqual({ path: 'a\nb' })
      expect(parse('{"path":"a\\rb"}')).toEqual({ path: 'a\rb' })
      expect(parse('{"path":"a\\tb"}')).toEqual({ path: 'a\tb' })
    })

    it.each([
      ['\\u0000', '\0'],
      ['\\u0020', ' '],
      ['\\u0061', 'a'],
      ['\\u00e9', 'é'],
      ['\\u00E9', 'é'],
      ['\\u0041', 'A'],
    ])('unescapes valid unicode %s', (escape, char) => {
      expect(parse(`{"path":"${escape}"}`)).toEqual({ path: char })
      expect(parse(`{"tool":"${escape}"}`)).toEqual({ tool: char })
    })

    it('skips a complete string whose unicode escape has fewer than 4 hex digits', () => {
      expect(parse('{"path":"\\u"}')).toBeNull()
      expect(parse('{"path":"\\u1"}')).toBeNull()
      expect(parse('{"path":"\\u12"}')).toBeNull()
      expect(parse('{"path":"\\u123"}')).toBeNull()
      expect(parse('{"tool":"\\u12"}')).toBeNull()
    })

    it('skips a complete string whose unicode escape is not hex', () => {
      expect(parse('{"path":"\\uGGGG"}')).toBeNull()
      expect(parse('{"path":"\\u12XG"}')).toBeNull()
      expect(parse('{"tool":"\\uZZZZ"}')).toBeNull()
    })

    it('keeps scanning after a skipped bad-unicode field', () => {
      expect(parse('{"path":"\\uGGGG","tool":"ok"}')).toEqual({ tool: 'ok' })
      expect(parse('{"tool":"\\u12","path":"src/a.ts"}')).toEqual({ path: 'src/a.ts' })
    })

    it.each(['\\x', '\\a', '\\b', '\\f', '\\v', '\\q'])(
      'drops the backslash and keeps the char for unknown escape %s',
      (escape) => {
        const kept = escape.slice(1)
        expect(parse(`{"path":"pre${escape}post"}`)).toEqual({
          path: `pre${kept}post`,
        })
      },
    )

    it('mixes several escapes in one path value', () => {
      expect(parse('{"path":"dir\\"sub\\\\file\\/a\\n\\t\\u0061.ts"}')).toEqual({
        path: 'dir"sub\\file/a\n\ta.ts',
      })
    })

    it('mixes several escapes in one tool value', () => {
      expect(parse('{"tool":"get\\"page\\/v1\\t\\u0062"}')).toEqual({
        tool: 'get"page/v1\tb',
      })
    })

    it('unescapes a unicode-encoded path key as path', () => {
      expect(parse('{"\\u0070ath":"src/a.ts"}')).toEqual({ path: 'src/a.ts' })
    })

    it('unescapes a unicode-encoded tool key as tool', () => {
      expect(parse('{"\\u0074ool":"search"}')).toEqual({ tool: 'search' })
    })

    it('skips a key whose unicode escape is invalid and keeps scanning', () => {
      expect(parse('{"pa\\uGGGG":"x","tool":"ok"}')).toEqual({ tool: 'ok' })
    })
  })

  describe('depth/nesting', () => {
    it('extracts only top-level path and tool at depth 1', () => {
      expect(parse('{"path":"src/a.ts","tool":"write_file"}')).toEqual({
        path: 'src/a.ts',
        tool: 'write_file',
      })
    })

    it('does not extract nested path or tool inside args', () => {
      expect(
        parse('{"tool":"get-page","args":{"path":"/docs","tool":"nested"}}'),
      ).toEqual({ tool: 'get-page' })
    })

    it('does not extract nested path or tool inside a nested object when no top-level field exists', () => {
      expect(parse('{"outer":{"path":"nope","tool":"nope"}}')).toBeNull()
    })

    it('ignores nested path inside arrays and still extracts a top-level tool', () => {
      expect(parse('{"items":[{"path":"nope"}],"tool":"real"}')).toEqual({
        tool: 'real',
      })
    })

    it('ignores nested tool inside arrays and still extracts a top-level path', () => {
      expect(parse('{"items":[{"tool":"nope"}],"path":"src/a.ts"}')).toEqual({
        path: 'src/a.ts',
      })
    })

    it('does not extract fields from a top-level array of objects', () => {
      expect(parse('[{"path":"src/a.ts","tool":"write"}]')).toBeNull()
    })

    it('does not treat path or tool appearing inside other string values as keys', () => {
      expect(
        parse('{"content":"hello \\"path\\":\\"nope\\"","note":"\\"tool\\":\\"fake\\""}'),
      ).toBeNull()
    })

    it('does not change depth for braces and brackets that live inside strings', () => {
      expect(
        parse('{"note":"has { and } and [ and ]","path":"src/a.ts","tool":"t"}'),
      ).toEqual({ path: 'src/a.ts', tool: 't' })
    })

    it('accepts pretty-printed JSON with spaces, tabs, and newlines around keys and colons', () => {
      expect(
        parse('{\n\t"path" : "src/a.ts",\n\t"tool" : "write_file"\n}'),
      ).toEqual({ path: 'src/a.ts', tool: 'write_file' })
    })

    it('accepts CR and CRLF around keys and colons', () => {
      expect(parse('{\r"path"\r:\r"src/a.ts"\r}')).toEqual({ path: 'src/a.ts' })
      expect(parse('{\r\n"tool"\r\n:\r\n"search"\r\n}')).toEqual({ tool: 'search' })
    })

    it('skips leading whitespace before the wrapping object', () => {
      expect(parse(' \n\t{"path":"src/a.ts"}')).toEqual({ path: 'src/a.ts' })
      expect(parse('\r\n  {"tool":"search"}')).toEqual({ tool: 'search' })
    })

    it('skips non-path/tool keys and still reads a later complete path or tool', () => {
      expect(parse('{"content":"hello","old":"y","path":"src/a.ts"}')).toEqual({
        path: 'src/a.ts',
      })
      expect(parse('{"serverId":"brave","name":"x","tool":"search"}')).toEqual({
        tool: 'search',
      })
    })

    it('returns fields found so far when a later key string is incomplete', () => {
      expect(parse('{"path":"src/a.ts","tool')).toEqual({ path: 'src/a.ts' })
      expect(parse('{')).toBeNull()
      expect(parse('{"pat')).toBeNull()
    })

    it('returns null when there is no wrapping object at depth 1', () => {
      expect(parse('"path":"src/a.ts"')).toBeNull()
      expect(parse('"tool":"search"')).toBeNull()
      expect(parse('path":"src/a.ts"')).toBeNull()
    })

    it('still returns extracted fields when content follows a complete object', () => {
      expect(parse('{"path":"src/a.ts"} trailing junk')).toEqual({ path: 'src/a.ts' })
      expect(parse('{"tool":"search"}{"ignored":true}')).toEqual({ tool: 'search' })
    })

    it('lets a second wrapping object overwrite an earlier complete field', () => {
      expect(parse('{"path":"first.ts"}{"path":"second.ts"}')).toEqual({
        path: 'second.ts',
      })
    })

    it('ignores prefix junk before the wrapping object', () => {
      expect(parse('garbage{"path":"src/a.ts"}')).toEqual({ path: 'src/a.ts' })
    })

    it('does not extract a path nested under an extra outer object', () => {
      expect(parse('{"outer":{"path":"src/a.ts"}}')).toBeNull()
    })

    it('extracts a top-level path that appears after nested objects and arrays', () => {
      expect(
        parse('{"args":{"path":"nope","items":[{"tool":"n"}]},"path":"real.ts"}'),
      ).toEqual({ path: 'real.ts' })
    })
  })

  describe('invalid values', () => {
    it.each([
      ['number', '{"path":123}'],
      ['true', '{"path":true}'],
      ['false', '{"path":false}'],
      ['null', '{"path":null}'],
      ['object', '{"path":{'],
      ['array', '{"path":['],
    ])('skips a non-string path value (%s) and returns null when nothing else is set', (_kind, json) => {
      expect(parse(json)).toBeNull()
    })

    it.each([
      ['number', '{"tool":123}'],
      ['true', '{"tool":true}'],
      ['false', '{"tool":false}'],
      ['null', '{"tool":null}'],
      ['object', '{"tool":{'],
      ['array', '{"tool":['],
    ])('skips a non-string tool value (%s) and returns null when nothing else is set', (_kind, json) => {
      expect(parse(json)).toBeNull()
    })

    it('keeps scanning after a non-string path to a later complete tool', () => {
      expect(parse('{"path":123,"tool":"search"}')).toEqual({ tool: 'search' })
      expect(parse('{"path":true,"tool":"search"}')).toEqual({ tool: 'search' })
      expect(parse('{"path":false,"tool":"search"}')).toEqual({ tool: 'search' })
      expect(parse('{"path":null,"tool":"search"}')).toEqual({ tool: 'search' })
      expect(parse('{"path":{"inner":"x"},"tool":"search"}')).toEqual({ tool: 'search' })
      expect(parse('{"path":["src/a.ts"],"tool":"search"}')).toEqual({ tool: 'search' })
    })

    it('keeps scanning after a non-string tool to a later complete path', () => {
      expect(parse('{"tool":1,"path":"src/a.ts"}')).toEqual({ path: 'src/a.ts' })
      expect(parse('{"tool":{"x":1},"path":"src/a.ts"}')).toEqual({ path: 'src/a.ts' })
      expect(parse('{"tool":["x"],"path":"src/a.ts"}')).toEqual({ path: 'src/a.ts' })
    })

    it('does not clear a completed path when a later duplicate is a non-string', () => {
      expect(parse('{"path":"src/a.ts","path":123}')).toEqual({ path: 'src/a.ts' })
    })

    it('does not clear a completed path when a later duplicate is empty', () => {
      expect(parse('{"path":"src/a.ts","path":""}')).toEqual({ path: 'src/a.ts' })
    })

    it('does not clear a completed tool when a later duplicate is empty', () => {
      expect(parse('{"tool":"search","tool":""}')).toEqual({ tool: 'search' })
    })

    it('assigns a later complete path after an earlier empty path', () => {
      expect(parse('{"path":"","path":"src/a.ts"}')).toEqual({ path: 'src/a.ts' })
    })

    it('lets the last complete assignment win for duplicate keys', () => {
      expect(parse('{"path":"first.ts","path":"second.ts"}')).toEqual({
        path: 'second.ts',
      })
      expect(parse('{"tool":"first","tool":"second"}')).toEqual({ tool: 'second' })
    })

    it('does not match Path, PATH, Tool, or TOOL keys', () => {
      expect(parse('{"Path":"src/a.ts"}')).toBeNull()
      expect(parse('{"PATH":"src/a.ts"}')).toBeNull()
      expect(parse('{"Tool":"search"}')).toBeNull()
      expect(parse('{"TOOL":"search"}')).toBeNull()
    })

    it('does not match keys that only contain path or tool as a prefix or suffix', () => {
      expect(parse('{"paths":"src/a.ts"}')).toBeNull()
      expect(parse('{"filepath":"src/a.ts"}')).toBeNull()
      expect(parse('{"tools":"search"}')).toBeNull()
      expect(parse('{"mytool":"search"}')).toBeNull()
    })

    it('does not treat a space-padded path key as path', () => {
      expect(parse('{" path ":"src/a.ts"}')).toBeNull()
    })

    it('does not treat form feed as whitespace after a colon', () => {
      expect(parse('{"path":\f"src/a.ts"}')).toBeNull()
    })

    it('does not treat a non-breaking space as whitespace after a colon', () => {
      expect(parse('{"path":\u00a0"src/a.ts"}')).toBeNull()
    })
  })

  describe('isolation', () => {
    it('does not leak buffers or values across toolCallIds in the same Map', () => {
      const buffers = new Map<string, string>()
      expect(extractPartialToolFields(buffers, 'call-a', '{"path":"a.ts"}')).toEqual({
        path: 'a.ts',
      })
      expect(extractPartialToolFields(buffers, 'call-b', '{"tool":"search"}')).toEqual({
        tool: 'search',
      })
      expect(buffers.get('call-a')).toBe('{"path":"a.ts"}')
      expect(buffers.get('call-b')).toBe('{"tool":"search"}')
      expect(extractPartialToolFields(buffers, 'call-a', '')).toEqual({ path: 'a.ts' })
      expect(extractPartialToolFields(buffers, 'call-b', '')).toEqual({ tool: 'search' })
    })

    it('keeps an incomplete buffer for one id from completing another id', () => {
      const buffers = new Map<string, string>()
      expect(extractPartialToolFields(buffers, 'call-a', '{"path":"src/a.')).toBeNull()
      expect(extractPartialToolFields(buffers, 'call-b', '{"path":"other.ts"}')).toEqual({
        path: 'other.ts',
      })
      expect(extractPartialToolFields(buffers, 'call-a', '')).toBeNull()
      expect(extractPartialToolFields(buffers, 'call-a', 'ts"}')).toEqual({
        path: 'src/a.ts',
      })
      expect(buffers.get('call-b')).toBe('{"path":"other.ts"}')
    })

    it('does not copy values from a completed sibling id onto a fresh id', () => {
      const buffers = new Map<string, string>()
      extractPartialToolFields(buffers, 'call-a', '{"tool":"search"}')
      expect(extractPartialToolFields(buffers, 'call-c', '{')).toBeNull()
      expect(buffers.get('call-c')).toBe('{')
    })
  })
})
