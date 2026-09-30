const noPoll =
  'End the turn and wait; the harness resumes as each background subagent finishes, so progress checks through tools (terminal_output, read_file, list_dir, glob_files, grep, git status or diff) only waste steps. terminal_output reads only run_terminal shell_id values.'

export default noPoll
