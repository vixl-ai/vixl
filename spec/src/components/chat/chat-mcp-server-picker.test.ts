import { describe, expect, it } from 'vitest'
import type { UnionedMcpServer } from '@/services/mcp/union-member-servers'
import {
  isMemberOwnedMcpPickerServer,
  mcpPickerMemberSetKey,
  mcpPickerServerMatchesQuery,
  mcpPickerSettingsTab,
  mcpPickerShowSettings,
  patchUnionMcpPickerRow,
  toSingleRootMcpPickerServer,
  unionMcpPickerProjectScopeKeys,
} from '@/components/chat/chat-mcp-server-picker'

const stdio = { command: 'npx', args: ['-y', 'example'] }

const personal: UnionedMcpServer = {
  id: 'brave',
  displayId: 'brave',
  scope: 'personal',
  scopeKey: 'personal',
  config: stdio,
}

const apiDocs: UnionedMcpServer = {
  id: 'docs',
  displayId: 'docs',
  scope: 'project',
  scopeKey: '/tmp/api',
  config: stdio,
  memberSlug: 'api',
}

const webDocs: UnionedMcpServer = {
  id: 'docs',
  displayId: 'web:docs',
  scope: 'project',
  scopeKey: '/tmp/web',
  config: stdio,
  memberSlug: 'web',
}

describe('chat mcp server picker helpers', () => {
  it('joins slug=rootPath pairs for member-set watches', () => {
    expect(
      mcpPickerMemberSetKey([
        { slug: 'api', name: 'API', rootPath: '/tmp/api' },
        { slug: 'web', name: 'Web', rootPath: '/tmp/web' },
      ]),
    ).toBe('api=/tmp/api\nweb=/tmp/web')
    expect(mcpPickerMemberSetKey(undefined)).toBe('')
  })

  it('treats only member-scoped rows as member owned', () => {
    expect(isMemberOwnedMcpPickerServer(personal)).toBe(false)
    expect(isMemberOwnedMcpPickerServer(apiDocs)).toBe(true)
    expect(
      isMemberOwnedMcpPickerServer({
        ...apiDocs,
        scopeKey: '   ',
      }),
    ).toBe(false)
  })

  it('lists distinct non-personal project scope keys', () => {
    expect(unionMcpPickerProjectScopeKeys([personal, apiDocs, webDocs, apiDocs])).toEqual([
      '/tmp/api',
      '/tmp/web',
    ])
  })

  it('maps a single-root effective server onto a union row', () => {
    expect(
      toSingleRootMcpPickerServer(
        { id: 'docs', config: stdio, scope: 'project' },
        '/tmp/vixl',
      ),
    ).toEqual({
      id: 'docs',
      displayId: 'docs',
      scope: 'project',
      scopeKey: '/tmp/vixl',
      config: stdio,
    })
    expect(
      toSingleRootMcpPickerServer(
        { id: 'brave', config: stdio, scope: 'personal' },
        '/tmp/vixl',
      ).scopeKey,
    ).toBe('personal')
  })

  it('matches search against id, displayId, and member slug', () => {
    expect(mcpPickerServerMatchesQuery(webDocs, 'web:')).toBe(true)
    expect(mcpPickerServerMatchesQuery(apiDocs, 'api')).toBe(true)
    expect(mcpPickerServerMatchesQuery(personal, 'BRAVE')).toBe(true)
    expect(mcpPickerServerMatchesQuery(personal, 'missing')).toBe(false)
    expect(mcpPickerServerMatchesQuery(personal, '  ')).toBe(true)
  })

  it('routes personal rows to the personal settings tab', () => {
    expect(mcpPickerSettingsTab(personal)).toBe('personal')
    expect(mcpPickerSettingsTab(apiDocs)).toBe('project')
  })

  it('hides settings only for member rows that are not the fleet active root', () => {
    expect(mcpPickerShowSettings(personal, '/tmp/api')).toBe(true)
    expect(mcpPickerShowSettings(apiDocs, '/tmp/api')).toBe(true)
    expect(mcpPickerShowSettings(webDocs, '/tmp/api')).toBe(false)
    expect(mcpPickerShowSettings(apiDocs, null)).toBe(false)
  })

  it('patches only the matching union row enabled flag', () => {
    const patched = patchUnionMcpPickerRow([personal, apiDocs, webDocs], apiDocs, false)
    expect(patched[1]?.config.enabled).toBe(false)
    expect(patched[0]).toBe(personal)
    expect(patched[2]).toBe(webDocs)
    expect(patchUnionMcpPickerRow([personal, apiDocs], webDocs, true)).toEqual([
      personal,
      apiDocs,
    ])
    const collision = patchUnionMcpPickerRow([apiDocs, webDocs], webDocs, true)
    expect(collision[0]?.config.enabled).toBeUndefined()
    expect(collision[1]?.config.enabled).toBe(true)
  })
})
