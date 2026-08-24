import { describe, expect, it } from 'vitest'
import { assertSafeMcpEnvOverlay, isDangerousMcpEnvKey } from '@/services/mcp/mcp-dangerous-env'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import { isMcpTrusted, sessionTrusts, upsertMcpTrustRecord } from '@/services/mcp/mcp-trust'
import { MODE_TOOL_ALLOWLIST } from '@/services/harness/mode-allowlists'
import { SUBAGENT_MCP_TOOLS } from '@/services/harness/build-tools'

describe('mcp-dangerous-env', () => {
  it('rejects LD_PRELOAD and PATH', () => {
    expect(isDangerousMcpEnvKey('LD_PRELOAD')).toBe(true)
    expect(isDangerousMcpEnvKey('PATH')).toBe(true)
    expect(isDangerousMcpEnvKey('BRAVE_API_KEY')).toBe(false)
    expect(() => assertSafeMcpEnvOverlay({ LD_PRELOAD: 'x' })).toThrow(/not allowed/)
    expect(assertSafeMcpEnvOverlay({ BRAVE_API_KEY: 'secret' })).toEqual({
      BRAVE_API_KEY: 'secret',
    })
  })
})

describe('mcp-server-fingerprint', () => {
  it('changes when url or command args change', () => {
    const a = mcpServerFingerprint({ type: 'http', url: 'https://a.example/mcp' })
    const b = mcpServerFingerprint({ type: 'http', url: 'https://b.example/mcp' })
    expect(a).not.toBe(b)

    const c = mcpServerFingerprint({ command: 'npx', args: ['-y', 'pkg'] })
    const d = mcpServerFingerprint({ command: 'npx', args: ['-y', 'evil'] })
    expect(c).not.toBe(d)
  })
})

describe('mcp-trust fingerprint', () => {
  it('drops trust when fingerprint mismatches', () => {
    sessionTrusts.clear()
    const settings = {
      version: 1,
      'agent.mcp.trust': upsertMcpTrustRecord([], 'brave', 'always', 'fp-a'),
    } as import('@/types/vixl/vixl-settings').VixlSettings
    expect(isMcpTrusted(settings, 'brave', 'fp-a')).toBe(true)
    expect(isMcpTrusted(settings, 'brave', 'fp-b')).toBe(false)
  })
})

describe('mode allowlists mcp', () => {
  const mcpTools = [
    'call_mcp_tool',
    'get_mcp_tools',
    'list_mcp_resources',
    'read_mcp_resource',
    'get_mcp_prompt',
  ]

  it('includes MCP in ask, plan, studio, agent, and orchestrator', () => {
    for (const name of mcpTools) {
      expect(MODE_TOOL_ALLOWLIST.ask).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.plan).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.studio).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.agent).toContain(name)
      expect(MODE_TOOL_ALLOWLIST.orchestrator).toContain(name)
    }
  })

  it('exposes MCP tools for subagents', () => {
    for (const name of mcpTools) {
      expect(SUBAGENT_MCP_TOOLS).toContain(name)
    }
  })
})
