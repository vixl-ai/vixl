import { describe, expect, it } from 'vitest'
import {
  isPersonalOnlyProjectKey,
  mergeKeyedSettingRecords,
  mergeSettings,
  stripPersonalOnlyProjectOverrides,
} from '@/services/config/merge-settings'
import { parseProjectOverrides } from '@/services/config/vixl-config'
import { defaultVixlSettings } from '@/schemas/vixl-settings'
import type {
  McpTrustRecord,
  PermissionRecord,
} from '@/types/harness/permission'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

describe('isPersonalOnlyProjectKey', () => {
  it('matches providers, models, and lsp prefixes', () => {
    expect(isPersonalOnlyProjectKey('providers.openai.apiKeyRef')).toBe(true)
    expect(isPersonalOnlyProjectKey('providers.custom.local')).toBe(true)
    expect(isPersonalOnlyProjectKey('models.default')).toBe(true)
    expect(isPersonalOnlyProjectKey('models.agent')).toBe(true)
    expect(isPersonalOnlyProjectKey('lsp.autoDownload')).toBe(true)
  })

  it('does not match other sections', () => {
    expect(isPersonalOnlyProjectKey('appearance.theme')).toBe(false)
    expect(isPersonalOnlyProjectKey('agent.permissionLevel')).toBe(false)
  })
})

describe('stripPersonalOnlyProjectOverrides', () => {
  it('removes providers, models, and lsp keys while keeping other overrides', () => {
    const project: VixlSettings = {
      version: 1,
      'lsp.autoDownload': false,
      'appearance.theme': 'dark',
      'models.default': 'anthropic::claude-sonnet-4-5',
      'providers.openai.apiKeyRef': 'openai',
      'providers.custom.local': {
        type: 'openai-compatible',
        name: 'Local',
        baseURL: 'http://localhost:1234/v1',
      },
    }

    const stripped = stripPersonalOnlyProjectOverrides(project)

    expect(stripped).toEqual({
      version: 1,
      'appearance.theme': 'dark',
    })
  })
})

describe('parseProjectOverrides', () => {
  it('strips providers, models, and lsp keys from project records', () => {
    const parsed = parseProjectOverrides({
      version: 1,
      'lsp.autoDownload': false,
      'appearance.theme': 'dark',
      'models.default': 'openai::gpt-4o',
      'providers.anthropic.apiKeyRef': 'anthropic',
      'providers.custom.kat': {
        type: 'openai-compatible',
        name: 'Kat',
        baseURL: 'http://localhost:1234/v1',
      },
    })

    expect(parsed).toEqual({
      version: 1,
      'appearance.theme': 'dark',
    })
  })
})

describe('mergeSettings with stripped project overrides', () => {
  it('does not let project providers, models, or lsp override personal', () => {
    const personal: VixlSettings = {
      ...defaultVixlSettings(),
      'models.default': 'anthropic::claude-sonnet-4-5',
      'providers.openai.apiKeyRef': 'openai',
      'lsp.autoDownload': true,
    }
    const projectRaw = {
      version: 1 as const,
      'models.default': 'openai::gpt-4o',
      'providers.openai.apiKeyRef': 'other',
      'lsp.autoDownload': false,
      'appearance.theme': 'dark',
    }
    const project = parseProjectOverrides(projectRaw)
    const effective = mergeSettings(personal, project)

    expect(effective['models.default']).toBe('anthropic::claude-sonnet-4-5')
    expect(effective['providers.openai.apiKeyRef']).toBe('openai')
    expect(effective['lsp.autoDownload']).toBe(true)
    expect(effective['appearance.theme']).toBe('dark')
  })
})

describe('mergeSettings keyed grant arrays', () => {
  it('unions personal Always MCP trust with project CodeGraph leftover', () => {
    const personal: VixlSettings = {
      ...defaultVixlSettings(),
      'agent.mcp.trust': [
        {
          serverId: 'brave',
          scope: 'always',
          fingerprint: 'fp-brave',
        },
      ],
    }
    const project: VixlSettings = {
      version: 1,
      'agent.mcp.trust': [
        {
          serverId: 'codegraph',
          scope: 'workspace',
          fingerprint: 'fp-codegraph',
        },
      ],
    }

    const effective = mergeSettings(personal, project)
    const trust = effective['agent.mcp.trust'] ?? []

    expect(trust).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ serverId: 'brave', scope: 'always' }),
        expect.objectContaining({ serverId: 'codegraph', scope: 'workspace' }),
      ]),
    )
    expect(trust).toHaveLength(2)
  })

  it('lets project MCP trust win for the same serverId unless personal is never', () => {
    const personal: VixlSettings = {
      ...defaultVixlSettings(),
      'agent.mcp.trust': [
        { serverId: 'brave', scope: 'always', fingerprint: 'fp-old' },
        { serverId: 'blocked', scope: 'never', fingerprint: 'fp-blocked' },
      ],
    }
    const project: VixlSettings = {
      version: 1,
      'agent.mcp.trust': [
        { serverId: 'brave', scope: 'workspace', fingerprint: 'fp-new' },
        { serverId: 'blocked', scope: 'workspace', fingerprint: 'fp-blocked' },
      ],
    }

    const effective = mergeSettings(personal, project)
    const byId = new Map(
      (effective['agent.mcp.trust'] ?? []).map((record) => [record.serverId, record]),
    )

    expect(byId.get('brave')).toEqual({
      serverId: 'brave',
      scope: 'workspace',
      fingerprint: 'fp-new',
    })
    expect(byId.get('blocked')).toEqual({
      serverId: 'blocked',
      scope: 'never',
      fingerprint: 'fp-blocked',
    })
  })

  it('unions personal Always permissions with project workspace grants', () => {
    const personal: VixlSettings = {
      ...defaultVixlSettings(),
      'agent.permissions': [
        {
          capability: 'fs.write:src/a.ts',
          verdict: 'allow',
          scope: 'always',
        },
      ],
    }
    const project: VixlSettings = {
      version: 1,
      'agent.permissions': [
        {
          capability: 'git.commit',
          verdict: 'allow',
          scope: 'workspace',
        },
      ],
    }

    const effective = mergeSettings(personal, project)
    const permissions = effective['agent.permissions'] ?? []

    expect(permissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ capability: 'fs.write:src/a.ts', scope: 'always' }),
        expect.objectContaining({ capability: 'git.commit', scope: 'workspace' }),
      ]),
    )
    expect(permissions).toHaveLength(2)
  })

  it('lets deny win over allow for the same capability', () => {
    const personal: VixlSettings = {
      ...defaultVixlSettings(),
      'agent.permissions': [
        {
          capability: 'fs.write:src/secret.ts',
          verdict: 'deny',
          scope: 'always',
        },
      ],
    }
    const project: VixlSettings = {
      version: 1,
      'agent.permissions': [
        {
          capability: 'fs.write:src/secret.ts',
          verdict: 'allow',
          scope: 'workspace',
        },
      ],
    }

    const effective = mergeSettings(personal, project)
    expect(effective['agent.permissions']).toEqual([
      {
        capability: 'fs.write:src/secret.ts',
        verdict: 'deny',
        scope: 'always',
      },
    ])
  })

  it('unions autoApproveGlobs without dropping personal entries', () => {
    const personal: VixlSettings = {
      ...defaultVixlSettings(),
      'agent.autoApproveGlobs': ['src/**', 'docs/**'],
    }
    const project: VixlSettings = {
      version: 1,
      'agent.autoApproveGlobs': ['docs/**', 'tmp/**'],
    }

    const effective = mergeSettings(personal, project)
    expect(effective['agent.autoApproveGlobs']).toEqual(['src/**', 'docs/**', 'tmp/**'])
  })
})

describe('mergeKeyedSettingRecords', () => {
  it('uses resolveConflict only when keys collide', () => {
    const personal: McpTrustRecord[] = [
      { serverId: 'a', scope: 'always', fingerprint: '1' },
    ]
    const project: McpTrustRecord[] = [
      { serverId: 'b', scope: 'workspace', fingerprint: '2' },
      { serverId: 'a', scope: 'workspace', fingerprint: '3' },
    ]

    const merged = mergeKeyedSettingRecords(
      personal,
      project,
      (record) => record.serverId,
      (personalRecord, projectRecord) => {
        expect(personalRecord.serverId).toBe(projectRecord.serverId)
        return projectRecord
      },
    )

    expect(merged).toEqual([
      { serverId: 'a', scope: 'workspace', fingerprint: '3' },
      { serverId: 'b', scope: 'workspace', fingerprint: '2' },
    ])
  })

  it('merges permission records by capability', () => {
    const personal: PermissionRecord[] = [
      { capability: 'shell', verdict: 'deny', scope: 'always' },
    ]
    const project: PermissionRecord[] = [
      { capability: 'shell', verdict: 'allow', scope: 'workspace' },
      { capability: 'git.commit', verdict: 'allow', scope: 'workspace' },
    ]

    const merged = mergeKeyedSettingRecords(
      personal,
      project,
      (record) => record.capability,
      (personalRecord, projectRecord) =>
        personalRecord.verdict === 'deny' ? personalRecord : projectRecord,
    )

    expect(merged).toEqual([
      { capability: 'shell', verdict: 'deny', scope: 'always' },
      { capability: 'git.commit', verdict: 'allow', scope: 'workspace' },
    ])
  })
})

describe('defaultVixlSettings', () => {
  it('does not include appearance.fontSize', () => {
    const defaults = defaultVixlSettings()
    expect('appearance.fontSize' in defaults).toBe(false)
    expect(defaults['appearance.theme']).toBe('system')
  })
})
