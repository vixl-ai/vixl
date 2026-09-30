export type TextPart = {
  text: string
  mono?: boolean
}

const MONO_RE = /(PLAN\.md|\.vixl\/plans)/g

export function splitMonoPaths(text: string): TextPart[] {
  const parts: TextPart[] = []
  let last = 0
  for (const match of text.matchAll(MONO_RE)) {
    const index = match.index ?? 0
    if (index > last) {
      parts.push({ text: text.slice(last, index) })
    }
    parts.push({ text: match[0], mono: true })
    last = index + match[0].length
  }
  if (last < text.length) {
    parts.push({ text: text.slice(last) })
  }
  return parts.length ? parts : [{ text }]
}
