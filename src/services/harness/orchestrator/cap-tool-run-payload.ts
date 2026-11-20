import {
  clipTerminalOutput,
  TERMINAL_OUTPUT_MAX_CHARS,
} from '@/utils/clip-terminal-output'

/**
 * Bound tool-run payloads before they are persisted to chat_messages.
 * Error results carrying full CI logs have reached tens of MB in a single
 * row, holding the shared SQLite connection lock during writes and bloating
 * the database. Long strings are clipped with the same head/tail marker used
 * for live terminal output, and object shape is preserved so UI parsers and
 * resume logic keep working. Clipping is idempotent.
 */
const capToolRunPayload = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return value.length > TERMINAL_OUTPUT_MAX_CHARS
      ? clipTerminalOutput(value)
      : value
  }
  if (Array.isArray(value)) {
    return value.map(capToolRunPayload)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, capToolRunPayload(entry)]),
    )
  }
  return value
}

export default capToolRunPayload