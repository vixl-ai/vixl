import { describe, expect, it } from 'vitest'
import formatToolRunLabel from '@/utils/format-tool-run-label'
import humanizeToolName from '@/utils/humanize-tool-name'
import type { ToolRun } from '@/types/harness/tool-run'

const toolRun = (partial: Partial<ToolRun> & Pick<ToolRun, 'name'>): ToolRun => ({
  toolCallId: 'call-1',
  status: 'done',
  ...partial,
})

describe('humanizeToolName', () => {
  it('title-cases snake_case names', () => {
    expect(humanizeToolName('brave_web_search')).toBe('Brave Web Search')
  })

  it('title-cases kebab-case names', () => {
    expect(humanizeToolName('get-page')).toBe('Get Page')
  })

  it('drops empty parts from mixed separators', () => {
    expect(humanizeToolName('brave__web--search')).toBe('Brave Web Search')
  })

  it('lowercases the rest of each word', () => {
    expect(humanizeToolName('BRAVE_WEB_SEARCH')).toBe('Brave Web Search')
  })
})

describe('formatToolRunLabel call_mcp_tool', () => {
  it('labels snake_case MCP tools while running and when done', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'call_mcp_tool',
          status: 'running',
          args: { serverId: 'brave', tool: 'brave_web_search', args: { query: 'Brave Search API' } },
        }),
      ),
    ).toBe('Calling Brave Web Search')
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'call_mcp_tool',
          args: { serverId: 'brave', tool: 'brave_web_search', args: { query: 'Brave Search API' } },
        }),
      ),
    ).toBe('Called Brave Web Search')
  })

  it('labels kebab-case MCP tools while running and when done', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'call_mcp_tool',
          status: 'running',
          args: { serverId: 'nuxt-docs', tool: 'get-page', args: { path: '/getting-started' } },
        }),
      ),
    ).toBe('Calling Get Page')
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'call_mcp_tool',
          args: { serverId: 'nuxt-docs', tool: 'get-page', args: { path: '/getting-started' } },
        }),
      ),
    ).toBe('Called Get Page')
  })

  it('keeps generic MCP copy when tool is missing', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'call_mcp_tool',
          status: 'running',
          args: { serverId: 'brave' },
        }),
      ),
    ).toBe('Calling MCP tool')
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'call_mcp_tool',
          args: { serverId: 'brave', tool: '' },
        }),
      ),
    ).toBe('Called MCP tool')
  })

  it('labels rejected MCP calls with the humanized name', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'call_mcp_tool',
          status: 'rejected',
          args: { serverId: 'brave', tool: 'brave_web_search' },
        }),
      ),
    ).toBe('Called Brave Web Search (rejected)')
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'call_mcp_tool',
          status: 'rejected',
        }),
      ),
    ).toBe('Called MCP tool (rejected)')
  })

  it('does not append query or url hints onto MCP labels', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'call_mcp_tool',
          args: {
            serverId: 'brave',
            tool: 'brave_web_search',
            query: 'should not appear',
            url: 'https://example.com',
          },
        }),
      ),
    ).toBe('Called Brave Web Search')
  })

  it('leaves get_mcp_tools labels unchanged', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'get_mcp_tools',
          status: 'running',
        }),
      ),
    ).toBe('Listing MCP tools')
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'get_mcp_tools',
        }),
      ),
    ).toBe('Listed MCP tools')
  })

  it('labels get_mcp_tool while running and when done', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'get_mcp_tool',
          status: 'running',
        }),
      ),
    ).toBe('Fetching MCP tool schema')
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'get_mcp_tool',
        }),
      ),
    ).toBe('Fetched MCP tool schema')
  })

  it('labels spawn_subagent with agentName', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'spawn_subagent',
          status: 'running',
          args: { agentName: 'generalPurpose', description: 'Scan auth helpers' },
        }),
      ),
    ).toBe('Starting generalPurpose')
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'spawn_subagent',
          args: { agentName: 'generalPurpose' },
        }),
      ),
    ).toBe('generalPurpose')
  })

  it('title-cases unmapped tool names in the fallback', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'custom_widget_tool',
          status: 'running',
        }),
      ),
    ).toBe('Calling Custom Widget Tool')
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'custom-widget-tool',
        }),
      ),
    ).toBe('Custom Widget Tool')
  })
})
