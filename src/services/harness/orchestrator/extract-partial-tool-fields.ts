const isWhitespace = (ch: string): boolean =>
  ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t'

type PartialToolFields = {
  path?: string
  tool?: string
  description?: string
}

type StringScan = {
  start: number
  pos: number
  escape: boolean
}

type ScanState = {
  textLength: number
  offset: number
  depth: number
  incomplete: StringScan | null
  fields: PartialToolFields
}

// Scan state is keyed by the caller's buffer Map so each stream parses
// incrementally: a delta only scans new characters (plus the small pending
// token), instead of re-scanning the whole accumulated tool input. This keeps
// large write_file payloads from turning every delta into an O(n) rescan.
const statesByBuffers = new WeakMap<Map<string, string>, Map<string, ScanState>>()

const unescapeJsonString = (raw: string): string | null => {
  let result = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i]!
    if (ch !== '\\') {
      result += ch
      continue
    }
    const next = raw[i + 1]
    if (next === undefined) {
      return null
    }
    if (next === '"' || next === '\\' || next === '/') {
      result += next
      i += 1
      continue
    }
    if (next === 'n') {
      result += '\n'
      i += 1
      continue
    }
    if (next === 'r') {
      result += '\r'
      i += 1
      continue
    }
    if (next === 't') {
      result += '\t'
      i += 1
      continue
    }
    if (next === 'u') {
      const hex = raw.slice(i + 2, i + 6)
      if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
        return null
      }
      result += String.fromCharCode(Number.parseInt(hex, 16))
      i += 5
      continue
    }
    result += next
    i += 1
  }
  return result
}

type StringRead = { end: number; raw: string } | { incomplete: StringScan }

const readJsonString = (source: string, start: number, resume: StringScan | null): StringRead => {
  if (source[start] !== '"') {
    return { incomplete: { start, pos: start + 1, escape: false } }
  }
  const continuing = resume !== null && resume.start === start
  let i = continuing ? resume.pos : start + 1
  let escape = continuing ? resume.escape : false
  while (i < source.length) {
    const ch = source[i]!
    if (escape) {
      escape = false
      i += 1
      continue
    }
    if (ch === '\\') {
      escape = true
      i += 1
      continue
    }
    if (ch === '"') {
      return { end: i + 1, raw: source.slice(start + 1, i) }
    }
    i += 1
  }
  return { incomplete: { start, pos: i, escape } }
}

const assignField = (fields: PartialToolFields, keyName: string, value: string): void => {
  if (keyName === 'path') {
    fields.path = value
    return
  }
  if (keyName === 'tool') {
    fields.tool = value
    return
  }
  if (keyName === 'description') {
    fields.description = value
  }
}

const extractCompleteFields = (source: string, state: ScanState): void => {
  let i = state.offset
  let depth = state.depth
  const hold = (): void => {
    state.offset = i
    state.depth = depth
  }
  while (i < source.length) {
    const tokenStart = i
    const ch = source[i]!
    if (ch === '"') {
      const resume = state.incomplete
      const key = readJsonString(source, i, resume)
      if ('incomplete' in key) {
        state.incomplete = key.incomplete
        i = tokenStart
        hold()
        return
      }
      let j = key.end
      while (j < source.length && isWhitespace(source[j]!)) {
        j += 1
      }
      if (j >= source.length) {
        // The colon or value may still arrive; reprocess this token next delta.
        i = tokenStart
        hold()
        return
      }
      if (source[j] === ':' && depth === 1) {
        const keyName = unescapeJsonString(key.raw)
        j += 1
        while (j < source.length && isWhitespace(source[j]!)) {
          j += 1
        }
        if (keyName === 'path' || keyName === 'tool' || keyName === 'description') {
          if (j >= source.length) {
            i = tokenStart
            hold()
            return
          }
          if (source[j] !== '"') {
            i = j
            state.incomplete = null
            hold()
            continue
          }
          const value = readJsonString(source, j, resume)
          if ('incomplete' in value) {
            state.incomplete = value.incomplete
            i = tokenStart
            hold()
            return
          }
          const unescaped = unescapeJsonString(value.raw)
          if (unescaped !== null && unescaped.length > 0) {
            assignField(state.fields, keyName, unescaped)
          }
          i = value.end
          state.incomplete = null
          hold()
          continue
        }
        i = j
        state.incomplete = null
        hold()
        continue
      }
      i = key.end
      state.incomplete = null
      hold()
      continue
    }
    if (ch === '{' || ch === '[') {
      depth += 1
    } else if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1)
    }
    i += 1
    hold()
  }
  state.incomplete = null
}

export default (
  buffers: Map<string, string>,
  toolCallId: string,
  delta: string,
): PartialToolFields | null => {
  const next = `${buffers.get(toolCallId) ?? ''}${delta}`
  buffers.set(toolCallId, next)

  let states = statesByBuffers.get(buffers)
  if (!states) {
    states = new Map<string, ScanState>()
    statesByBuffers.set(buffers, states)
  }
  let state = states.get(toolCallId)
  if (!state || next.length < state.textLength) {
    state = { textLength: 0, offset: 0, depth: 0, incomplete: null, fields: {} }
    states.set(toolCallId, state)
  }
  state.textLength = next.length

  extractCompleteFields(next, state)

  const { path, tool, description } = state.fields
  if (path === undefined && tool === undefined && description === undefined) {
    return null
  }
  return { ...state.fields }
}
