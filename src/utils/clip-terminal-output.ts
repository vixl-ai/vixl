export const TERMINAL_OUTPUT_MAX_CHARS = 32_000

const HEAD_CHARS = 2_000
const MARKER_BUDGET_CHARS = 48
const MARKER_SLACK_CHARS = 2_000
const MARKER_PREFIX = '[output clipped:'

/**
 * Bound terminal text destined for the model context, chat parts, and the
 * DOM. Giant command output (full CI logs, raw HTML dumps) must never travel
 * through tool results as one string. Keeps the first 2000 chars plus as much
 * of the tail as fits, so the command banner and the final error summary stay
 * visible.
 *
 * Clipping is idempotent. A fresh clip never exceeds TERMINAL_OUTPUT_MAX_CHARS,
 * and an already-clipped string that a downstream layer composed with small
 * extra text (command prefix, sandboxing footer, retry hint) passes through
 * unchanged within the slack, keeping its accurate omitted count instead of
 * re-clipping over the marker.
 */
export const clipTerminalOutput = (text: string): string => {
  if (text.length <= TERMINAL_OUTPUT_MAX_CHARS) {
    return text
  }
  if (
    text.length <= TERMINAL_OUTPUT_MAX_CHARS + MARKER_SLACK_CHARS &&
    text.includes(MARKER_PREFIX)
  ) {
    return text
  }
  const tailChars = TERMINAL_OUTPUT_MAX_CHARS - HEAD_CHARS - MARKER_BUDGET_CHARS - 2
  const dropped = text.length - HEAD_CHARS - tailChars
  return [
    text.slice(0, HEAD_CHARS),
    `[output clipped: ${dropped} chars omitted]`,
    text.slice(-tailChars),
  ].join('\n')
}
