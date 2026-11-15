import { noPollTerminal } from '@/services/harness/guidance'

const ERROR_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  {
    pattern: /invalid args.*`request`/i,
    hint: 'Internal IPC mismatch: the harness failed to pass the correct request shape to the backend.',
  },
  {
    pattern: /unrecognized patch header/i,
    hint: 'apply_patch expects OpenCode format (*** Update File: path), not git diff (--- a/). Use edit_file for simple replacements.',
  },
  {
    pattern: /patch context does not match/i,
    hint: 'A hunk line was not found at or after the previous match; the error quotes the line that failed. Context lines may be written verbatim or with one leading space. Confirm the current file text before retrying, or use edit_file for a small exact replacement.',
  },
  {
    pattern: /at least one replacement is required/i,
    hint: 'edit_file requires a non-empty old_string that exists in the file.',
  },
  {
    pattern: /command timed out/i,
    hint: `The shell command exceeded the timeout. For dev servers and watchers, use is_background: true on run_terminal. ${noPollTerminal}`,
  },
  {
    pattern: /command failed/i,
    hint: 'The shell command returned a non-zero exit code. Check stderr and the SANDBOXING footer before retrying.',
  },
]

const isSandboxJailMessage = (message: string): boolean =>
  /SANDBOX_|isolated devices|isolated \/dev|Run outside sandbox|SANDBOXING:/i.test(
    message,
  )

export default (message: string): string => {
  const hint = ERROR_HINTS.find((entry) => entry.pattern.test(message))?.hint
  if (!hint) {
    return message
  }
  if (isSandboxJailMessage(message) && /edit_file/i.test(hint)) {
    return message
  }
  return `${message}\n\nHint: ${hint}`
}
