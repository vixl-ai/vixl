const isWhitespace = (ch: string): boolean =>
  ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t'

type PartialToolFields = {
  path?: string
  tool?: string
  description?: string
}

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

const readJsonString = (
  source: string,
  start: number,
): { end: number; raw: string } | null => {
  if (source[start] !== '"') {
    return null
  }
  let i = start + 1
  let escape = false
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
  return null
}

const assignField = (
  fields: PartialToolFields,
  keyName: string,
  value: string,
): void => {
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

const extractCompleteFields = (partialJson: string): PartialToolFields | null => {
  let i = 0
  let depth = 0
  const fields: PartialToolFields = {}
  while (i < partialJson.length) {
    const ch = partialJson[i]!
    if (ch === '"') {
      const key = readJsonString(partialJson, i)
      if (!key) {
        break
      }
      let j = key.end
      while (j < partialJson.length && isWhitespace(partialJson[j]!)) {
        j += 1
      }
      if (partialJson[j] === ':' && depth === 1) {
        const keyName = unescapeJsonString(key.raw)
        j += 1
        while (j < partialJson.length && isWhitespace(partialJson[j]!)) {
          j += 1
        }
        if (keyName === 'path' || keyName === 'tool' || keyName === 'description') {
          if (partialJson[j] !== '"') {
            i = j
            continue
          }
          const value = readJsonString(partialJson, j)
          if (!value) {
            break
          }
          const unescaped = unescapeJsonString(value.raw)
          if (unescaped !== null && unescaped.length > 0) {
            assignField(fields, keyName, unescaped)
          }
          i = value.end
          continue
        }
        i = j
        continue
      }
      i = key.end
      continue
    }
    if (ch === '{' || ch === '[') {
      depth += 1
    } else if (ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1)
    }
    i += 1
  }
  if (
    fields.path === undefined &&
    fields.tool === undefined &&
    fields.description === undefined
  ) {
    return null
  }
  return fields
}

export default (
  buffers: Map<string, string>,
  toolCallId: string,
  delta: string,
): PartialToolFields | null => {
  const next = `${buffers.get(toolCallId) ?? ''}${delta}`
  buffers.set(toolCallId, next)
  return extractCompleteFields(next)
}
