import type { VixlChatMode } from '@/types/vixl/vixl-settings'

export const READ_ONLY_SPAWN_MODES = new Set<VixlChatMode>(['ask', 'plan', 'studio'])

export const SUBAGENT_READ_ONLY_TOOLS = [
  'read_file',
  'list_dir',
  'grep',
  'glob_files',
  'codebase_explore',
  'codebase_search',
  'codebase_impact',
  'codebase_status',
  'git_status',
  'git_diff',
  'git_log',
  'git_branch',
  'lsp',
  'diagnostics',
  'load_skill',
  'web_fetch',
  'get_mcp_tools',
  'call_mcp_tool',
  'list_mcp_resources',
  'read_mcp_resource',
  'get_mcp_prompt',
] as const

export const SUBAGENT_WRITE_TOOLS = [
  ...SUBAGENT_READ_ONLY_TOOLS,
  'write_file',
  'edit_file',
  'apply_patch',
  'delete_file',
  'move_file',
  'run_terminal',
  'terminal_output',
  'stop_terminal',
  'git_commit',
  'git_checkout',
  'git_branch_create',
] as const

export const SUBAGENT_MCP_TOOLS = [
  'get_mcp_tools',
  'call_mcp_tool',
  'list_mcp_resources',
  'read_mcp_resource',
  'get_mcp_prompt',
] as const
