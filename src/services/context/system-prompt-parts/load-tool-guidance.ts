import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import { MODE_TOOL_ALLOWLIST } from '@/services/harness/mode-allowlists'
import loadPrompt from '@/services/prompts/load-prompt'

const SNIPPETS: Array<{ tools: readonly string[]; path: string }> = [
  { tools: ['get_mcp_tools', 'call_mcp_tool'], path: 'system/tool-guidance-mcp.md' },
  { tools: ['run_terminal'], path: 'system/tool-guidance-shell.md' },
  { tools: ['apply_patch'], path: 'system/tool-guidance-patch.md' },
]

export default (mode: VixlChatMode): string => {
  const allow = new Set(MODE_TOOL_ALLOWLIST[mode])
  const parts = [loadPrompt('system/tool-guidance.md')]
  for (const snippet of SNIPPETS) {
    if (snippet.tools.some((name) => allow.has(name))) {
      parts.push(loadPrompt(snippet.path))
    }
  }
  return parts.filter(Boolean).join('\n\n')
}
