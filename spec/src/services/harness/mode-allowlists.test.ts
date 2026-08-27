import { describe, expect, it } from 'vitest'
import { MODE_TOOL_ALLOWLIST } from '@/services/harness/mode-allowlists'

describe('mode allowlists codebase tools', () => {
  const codebaseTools = [
    'codebase_explore',
    'codebase_search',
    'codebase_impact',
    'codebase_status',
  ]

  it('includes codebase tools in ask, plan, agent, orchestrator, and studio', () => {
    for (const name of codebaseTools) {
      expect(MODE_TOOL_ALLOWLIST.ask).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.plan).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.agent).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.orchestrator).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.studio).toContain(name)
    }
  })
})

describe('mode allowlists parent shell tools', () => {
  const shellTools = ['run_terminal', 'terminal_output', 'stop_terminal'] as const

  it('includes run_terminal, terminal_output, and stop_terminal in ask, plan, and studio', () => {
    for (const name of shellTools) {
      expect(MODE_TOOL_ALLOWLIST.ask).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.plan).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.studio).toContain(name)
    }
  })
})

describe('mode allowlists resolve_models', () => {
  it('includes resolve_models in agent and orchestrator', () => {
    expect(MODE_TOOL_ALLOWLIST.agent).toContain('resolve_models')
    expect(MODE_TOOL_ALLOWLIST.orchestrator).toContain('resolve_models')
  })

  it('includes resolve_models in ask, plan, and studio', () => {
    expect(MODE_TOOL_ALLOWLIST.ask).toContain('resolve_models')
    expect(MODE_TOOL_ALLOWLIST.plan).toContain('resolve_models')
    expect(MODE_TOOL_ALLOWLIST.studio).toContain('resolve_models')
  })
})

describe('mode allowlists spawn_subagent', () => {
  it('includes spawn_subagent in ask, plan, studio, agent, and orchestrator', () => {
    expect(MODE_TOOL_ALLOWLIST.ask).toContain('spawn_subagent')
    expect(MODE_TOOL_ALLOWLIST.plan).toContain('spawn_subagent')
    expect(MODE_TOOL_ALLOWLIST.studio).toContain('spawn_subagent')
    expect(MODE_TOOL_ALLOWLIST.agent).toContain('spawn_subagent')
    expect(MODE_TOOL_ALLOWLIST.orchestrator).toContain('spawn_subagent')
  })
})

describe('mode allowlists mcp tools', () => {
  const mcpTools = [
    'call_mcp_tool',
    'get_mcp_tools',
    'list_mcp_resources',
    'read_mcp_resource',
    'get_mcp_prompt',
  ]

  it('includes mcp tools in ask, plan, and studio', () => {
    for (const name of mcpTools) {
      expect(MODE_TOOL_ALLOWLIST.ask).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.plan).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.studio).toContain(name)
    }
  })
})

describe('mode allowlists update_todos', () => {
  it('includes update_todos in agent and orchestrator', () => {
    expect(MODE_TOOL_ALLOWLIST.agent).toContain('update_todos')
    expect(MODE_TOOL_ALLOWLIST.orchestrator).toContain('update_todos')
  })

  it('excludes update_todos from ask, plan, and studio', () => {
    expect(MODE_TOOL_ALLOWLIST.ask).not.toContain('update_todos')
    expect(MODE_TOOL_ALLOWLIST.plan).not.toContain('update_todos')
    expect(MODE_TOOL_ALLOWLIST.studio).not.toContain('update_todos')
  })

  it('does not include write_todos in any mode', () => {
    expect(MODE_TOOL_ALLOWLIST.ask).not.toContain('write_todos')
    expect(MODE_TOOL_ALLOWLIST.plan).not.toContain('write_todos')
    expect(MODE_TOOL_ALLOWLIST.studio).not.toContain('write_todos')
    expect(MODE_TOOL_ALLOWLIST.agent).not.toContain('write_todos')
    expect(MODE_TOOL_ALLOWLIST.orchestrator).not.toContain('write_todos')
  })
})

describe('mode allowlists mutations', () => {
  const askAndPlanExcluded = [
    'write_file',
    'edit_file',
    'apply_patch',
    'delete_file',
    'move_file',
    'git_commit',
    'git_checkout',
    'git_branch_create',
    'update_todos',
    'write_studio_artifact',
  ]

  const studioExcluded = [
    'write_file',
    'edit_file',
    'apply_patch',
    'delete_file',
    'move_file',
    'git_commit',
    'git_checkout',
    'git_branch_create',
    'update_todos',
  ]

  it('excludes mutations from ask and plan', () => {
    for (const name of askAndPlanExcluded) {
      expect(MODE_TOOL_ALLOWLIST.ask).not.toContain(name)
      expect(MODE_TOOL_ALLOWLIST.plan).not.toContain(name)
    }
    expect(MODE_TOOL_ALLOWLIST.ask).not.toContain('create_plan')
    expect(MODE_TOOL_ALLOWLIST.plan).toContain('create_plan')
  })

  it('excludes file and git mutations from studio while keeping shell and studio artifact', () => {
    for (const name of studioExcluded) {
      expect(MODE_TOOL_ALLOWLIST.studio).not.toContain(name)
    }
    expect(MODE_TOOL_ALLOWLIST.studio).toContain('run_terminal')
    expect(MODE_TOOL_ALLOWLIST.studio).toContain('write_studio_artifact')
    expect(MODE_TOOL_ALLOWLIST.studio).toContain('create_plan')
  })
})

describe('mode allowlists web_fetch', () => {
  it('includes web_fetch in ask, plan, studio, agent, and orchestrator', () => {
    expect(MODE_TOOL_ALLOWLIST.ask).toContain('web_fetch')
    expect(MODE_TOOL_ALLOWLIST.plan).toContain('web_fetch')
    expect(MODE_TOOL_ALLOWLIST.studio).toContain('web_fetch')
    expect(MODE_TOOL_ALLOWLIST.agent).toContain('web_fetch')
    expect(MODE_TOOL_ALLOWLIST.orchestrator).toContain('web_fetch')
  })

  it('does not include embedded browser tools in any mode', () => {
    const browserTools = [
      'browser_tabs',
      'browser_navigate',
      'browser_lock',
      'browser_snapshot',
      'browser_take_screenshot',
      'browser_click',
      'browser_mouse_click_xy',
      'browser_type',
      'browser_fill',
      'browser_select_option',
      'browser_press_key',
      'browser_scroll',
      'browser_drag',
      'browser_get_bounding_box',
      'browser_highlight',
      'browser_cdp',
    ]
    for (const mode of ['ask', 'plan', 'studio', 'agent', 'orchestrator'] as const) {
      for (const name of browserTools) {
        expect(MODE_TOOL_ALLOWLIST[mode]).not.toContain(name)
      }
    }
  })
})
