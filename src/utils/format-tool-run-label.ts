import type { ToolRun } from '@/types/harness/tool-run'
import { clipTerminalLabel } from '@/utils/clip-terminal-label'

const TOOL_LABELS_DONE: Record<string, string> = {
  read_file: 'Read',
  write_file: 'Edited',
  edit_file: 'Edited',
  apply_patch: 'Patched',
  delete_file: 'Deleted',
  move_file: 'Moved',
  list_dir: 'Listed',
  glob_files: 'Searched files',
  grep: 'Searched',
  codebase_explore: 'Explored codebase',
  codebase_search: 'Searched codebase',
  codebase_impact: 'Checked impact',
  codebase_status: 'Checked CodeGraph status',
  git_status: 'Checked git status',
  git_diff: 'Viewed diff',
  git_log: 'Viewed git log',
  git_branch: 'Checked branch',
  git_checkout: 'Checked out branch',
  git_branch_create: 'Created branch',
  git_commit: 'Committed changes',
  run_terminal: 'Ran command',
  terminal_output: 'Read shell output',
  stop_terminal: 'Stopped shell',
  call_mcp_tool: 'Called MCP tool',
  get_mcp_tools: 'Listed MCP tools',
  create_plan: 'Created plan',
  update_plan_todo: 'Updated plan',
  update_todos: 'Updated todos',
  write_todos: 'Updated todos',
  lsp: 'LSP lookup',
  diagnostics: 'Read diagnostics',
  web_fetch: 'Fetched',
  resolve_models: 'Looked up models',
}

const TOOL_LABELS_RUNNING: Record<string, string> = {
  read_file: 'Reading',
  write_file: 'Editing',
  edit_file: 'Editing',
  apply_patch: 'Patching',
  delete_file: 'Deleting',
  move_file: 'Moving',
  list_dir: 'Listing',
  glob_files: 'Searching files',
  grep: 'Searching',
  codebase_explore: 'Exploring codebase',
  codebase_search: 'Searching codebase',
  codebase_impact: 'Checking impact',
  codebase_status: 'Checking CodeGraph status',
  git_status: 'Checking git status',
  git_diff: 'Viewing diff',
  git_log: 'Viewing git log',
  git_branch: 'Checking branch',
  git_checkout: 'Checking out branch',
  git_branch_create: 'Creating branch',
  git_commit: 'Committing changes',
  run_terminal: 'Running command',
  terminal_output: 'Reading shell output',
  stop_terminal: 'Stopping shell',
  call_mcp_tool: 'Calling MCP tool',
  get_mcp_tools: 'Listing MCP tools',
  create_plan: 'Writing plan',
  update_plan_todo: 'Updating plan',
  update_todos: 'Updating todos',
  write_todos: 'Updating todos',
  lsp: 'LSP lookup',
  diagnostics: 'Reading diagnostics',
  web_fetch: 'Fetching',
  resolve_models: 'Looking up models',
}

const formatArgsHint = (args: unknown, options?: { omitPathHint?: boolean }): string | null => {
  if (!args || typeof args !== 'object') {
    return null
  }
  const record = args as Record<string, unknown>
  const omitPath = options?.omitPathHint === true
  if (!omitPath && typeof record.path === 'string' && record.path.length > 0) {
    return record.path
  }
  if (typeof record.pattern === 'string' && record.pattern.length > 0) {
    return record.pattern
  }
  if (typeof record.url === 'string' && record.url.length > 0) {
    return record.url
  }
  if (typeof record.agentName === 'string' && record.agentName.length > 0) {
    return record.agentName
  }
  if (typeof record.description === 'string' && record.description.length > 0) {
    const label = clipTerminalLabel(record.description)
    if (label.length > 0) {
      return label
    }
  }
  if (typeof record.command === 'string' && record.command.length > 0) {
    return record.command
  }
  if (typeof record.query === 'string' && record.query.length > 0) {
    return record.query
  }
  if (typeof record.symbol === 'string' && record.symbol.length > 0) {
    return record.symbol
  }
  if (!omitPath && typeof record.from === 'string' && record.from.length > 0) {
    return record.from
  }
  return null
}

const formatSpawnSubagentLabel = (run: ToolRun): string => {
  const hint = formatArgsHint(run.args)
  const name = hint?.trim() || 'Sub-agent'
  if (run.status === 'running') {
    return `Starting ${name}…`
  }
  if (run.status === 'rejected') {
    return `${name} (rejected)`
  }
  return name
}

const humanizeToolName = (name: string): string => name.replaceAll('_', ' ')

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

const formatTerminalRunLabel = (run: ToolRun, isRunning: boolean): string => {
  const args = asRecord(run.args)
  const result = asRecord(run.result)
  const desc = clipTerminalLabel(
    (typeof result?.description === 'string' ? result.description : '') ||
      (typeof args?.description === 'string' ? args.description : ''),
  )
  const mapped = isRunning ? TOOL_LABELS_RUNNING[run.name] : TOOL_LABELS_DONE[run.name]
  const prefix = mapped ?? (isRunning ? 'Running command' : 'Ran command')
  const target = desc.length > 0 ? ` ${desc}` : ''
  if (isRunning) {
    return `${prefix}${target}…`
  }
  if (run.status === 'rejected') {
    return `${prefix}${target} (rejected)`
  }
  return `${prefix}${target}`
}

export default (run: ToolRun, options?: { omitPathHint?: boolean }): string => {
  if (run.name === 'spawn_subagent') {
    return formatSpawnSubagentLabel(run)
  }

  const isRunning = run.status === 'running'

  if (
    run.name === 'run_terminal' ||
    run.name === 'terminal_output' ||
    run.name === 'stop_terminal'
  ) {
    return formatTerminalRunLabel(run, isRunning)
  }

  const mapped = isRunning ? TOOL_LABELS_RUNNING[run.name] : TOOL_LABELS_DONE[run.name]
  const prefix =
    mapped ?? (isRunning ? `Calling ${humanizeToolName(run.name)}` : humanizeToolName(run.name))
  const hint = formatArgsHint(run.args, options)
  const target = hint ? ` ${hint}` : ''

  if (isRunning) {
    return `${prefix}${target}…`
  }
  if (run.status === 'rejected') {
    return `${prefix}${target} (rejected)`
  }
  return `${prefix}${target}`
}
