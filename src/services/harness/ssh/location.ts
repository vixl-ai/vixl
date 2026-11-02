import {
  isSshProjectRoot,
  RUNS_ON_THIS_MAC,
  sshRunsAsLineFromRoot,
} from '@/utils/ssh-project-root'

const REMOTE_TOOL_NAMES = new Set([
  'read_file',
  'list_dir',
  'grep',
  'glob_files',
  'write_file',
  'edit_file',
  'apply_patch',
  'delete_file',
  'move_file',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'git_checkout',
  'git_branch_create',
  'git_commit',
  'run_terminal',
  'terminal_output',
  'stop_terminal',
  'codebase_explore',
  'codebase_search',
  'codebase_impact',
  'codebase_status',
  'lsp',
  'diagnostics',
  'create_plan',
  'update_plan',
  'update_plan_todo',
  'call_mcp_tool',
  'get_mcp_tools',
  'get_mcp_tool',
  'list_mcp_resources',
  'read_mcp_resource',
  'get_mcp_prompt',
  'worktree_create',
  'worktree_remove',
])

export const toolRunsAtLine = (
  projectRoot: string,
  toolName: string,
): string | null => {
  if (!isSshProjectRoot(projectRoot)) {
    return null
  }
  if (toolName === 'web_fetch') {
    return RUNS_ON_THIS_MAC
  }
  if (REMOTE_TOOL_NAMES.has(toolName)) {
    return sshRunsAsLineFromRoot(projectRoot)
  }
  return null
}

export const annotateRunsAt = (
  projectRoot: string,
  toolName: string,
  result: unknown,
): unknown => {
  const runsAt = toolRunsAtLine(projectRoot, toolName)
  if (!runsAt) {
    return result
  }
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    if ('runsAt' in result && typeof (result as { runsAt?: unknown }).runsAt === 'string') {
      return result
    }
    return { ...(result as Record<string, unknown>), runsAt }
  }
  return result
}
