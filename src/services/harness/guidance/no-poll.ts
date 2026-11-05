const noPoll =
  'End the turn and wait; the harness resumes when a background subagent finishes and when a background terminal exits, so progress checks through tools (terminal_output, read_file, list_dir, glob_files, grep, git status or diff) only waste steps. terminal_output reads output for a run_terminal shell id before that shell exits; it is not how you wait for completion.'

export const noPollTerminal =
  'is_background returns a shell id; end the turn and wait. The harness resumes when that background terminal exits. terminal_output reads output for a run_terminal shell id before that shell exits; it is not how you wait for completion.'

export default noPoll
