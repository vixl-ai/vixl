export const REASONING_REVEAL_CHARS_PER_FRAME = 120

const isWhitespace = (char: string | undefined): boolean =>
  typeof char === 'string' && /\s/.test(char)

/**
 * Advance a locally revealed reasoning prefix toward `target` by about
 * 120 characters, stopping on a word boundary when one exists in that window.
 */
export const nextRevealedReasoning = (shown: string, target: string): string => {
  if (shown === target) {
    return shown
  }

  const from = target.startsWith(shown) ? shown.length : 0
  const remaining = target.length - from
  if (remaining <= REASONING_REVEAL_CHARS_PER_FRAME) {
    return target
  }

  const windowEnd = from + REASONING_REVEAL_CHARS_PER_FRAME
  const lastInWindow = target[windowEnd - 1]
  const afterWindow = target[windowEnd]
  if (isWhitespace(lastInWindow) || isWhitespace(afterWindow)) {
    return target.slice(0, windowEnd)
  }

  const window = target.slice(from, windowEnd)
  let lastWs = -1
  for (let i = window.length - 1; i >= 0; i -= 1) {
    if (isWhitespace(window[i])) {
      lastWs = i
      break
    }
  }

  if (lastWs === -1) {
    return target.slice(0, windowEnd)
  }

  return target.slice(0, from + lastWs + 1)
}
