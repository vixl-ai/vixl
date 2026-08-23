const ERROR_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  {
    pattern: /invalid args.*`request`/i,
    hint: 'Internal IPC mismatch — the harness failed to pass the correct request shape to the backend.',
  },
  {
    pattern: /unrecognized patch header/i,
    hint: 'apply_patch expects OpenCode format (*** Update File: path), not git diff (--- a/). Use edit_file for simple replacements.',
  },
  {
    pattern: /patch context does not match/i,
    hint: 'The patch hunks do not match the current file contents. Re-read the file and try edit_file instead.',
  },
  {
    pattern: /at least one replacement is required/i,
    hint: 'edit_file requires a non-empty old_string that exists in the file.',
  },
  {
    pattern: /command timed out/i,
    hint: 'The shell command exceeded the timeout. For dev servers and watchers, use is_background: true on run_terminal and poll with terminal_output.',
  },
  {
    pattern: /command failed/i,
    hint: 'The shell command returned a non-zero exit code. Check stderr and the SANDBOXING footer before retrying.',
  },
  {
    pattern: /-32602|invalid_cdp_params|params\.expression/i,
    hint: 'For Runtime.evaluate, params.expression must be a JavaScript source string (e.g. "document.title"), never { expression: "..." }.',
  },
]

const isSandboxJailMessage = (message: string): boolean =>
  /SANDBOX_|isolated devices|isolated \/dev|Run outside sandbox/i.test(message)

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
