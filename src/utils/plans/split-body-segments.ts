type PlanBodySegment =
  | { type: 'markdown'; content: string }
  | { type: 'mermaid'; content: string }

const MERMAID_FENCE_RE = /```mermaid\s*\n([\s\S]*?)```/g

export default (text: string): PlanBodySegment[] => {
  if (!text.trim()) {
    return []
  }

  const segments: PlanBodySegment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(MERMAID_FENCE_RE)) {
    const start = match.index ?? 0
    if (start > lastIndex) {
      segments.push({ type: 'markdown', content: text.slice(lastIndex, start) })
    }
    segments.push({ type: 'mermaid', content: match[1] ?? '' })
    lastIndex = start + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'markdown', content: text.slice(lastIndex) })
  }

  if (segments.length === 0) {
    return [{ type: 'markdown', content: text }]
  }

  return segments
}
