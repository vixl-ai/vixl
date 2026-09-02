import { describe, expect, it } from 'vitest'
import {
  customProviderModelSchema,
  customProviderSchema,
} from '@/schemas/providers/custom-provider'
import {
  migrateVixlSettings,
  normalizeStoredModelRef,
  validateVixlSettings,
} from '@/schemas/vixl-settings'
import { providerRequiresApiKey } from '@/services/providers/registry'
import {
  resolveMaxInputTokens,
  resolveModelCallOptions,
  resolveSideTaskCallOptions,
} from '@/services/models/resolve-model-call-options'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

describe('migrateVixlSettings', () => {
  it('migrates deprecated provider and model keys', () => {
    const migrated = migrateVixlSettings({
      version: 1,
      'agent.defaultProvider': 'anthropic',
      'agent.defaultModel': 'claude-sonnet-4-5',
      'chat.autoTitleModel': 'claude-haiku-4-5',
    })

    expect(migrated['models.default']).toBe('anthropic::claude-sonnet-4-5')
    expect(migrated['models.title']).toBe('anthropic::claude-haiku-4-5')
    expect('agent.defaultProvider' in migrated).toBe(false)
    expect('agent.defaultModel' in migrated).toBe(false)
    expect('chat.autoTitleModel' in migrated).toBe(false)
  })

  it('strips removed fleet and default mode keys', () => {
    const migrated = migrateVixlSettings({
      version: 1,
      'agent.defaultMode': 'plan',
      'fleet.maxConcurrentAgents': 4,
      'fleet.trayBackground': true,
    })

    expect('agent.defaultMode' in migrated).toBe(false)
    expect('fleet.maxConcurrentAgents' in migrated).toBe(false)
    expect('fleet.trayBackground' in migrated).toBe(false)
  })

  it('strips general.machineLabel', () => {
    const migrated = migrateVixlSettings({
      version: 1,
      'general.machineLabel': 'Office laptop',
    })

    expect('general.machineLabel' in migrated).toBe(false)
  })

  it('defaults duplicate tab behavior to ask', () => {
    const migrated = migrateVixlSettings({ version: 1 })

    expect(migrated['workbench.duplicateTabBehavior']).toBe('ask')
  })

  it('defaults sandbox enabled with network allow', () => {
    const migrated = migrateVixlSettings({ version: 1 })

    expect(migrated['agent.sandbox.enabled']).toBe(true)
    expect(migrated['agent.sandbox.network']).toBe('allow')
  })

  it('keeps stored sandbox network deny', () => {
    const migrated = migrateVixlSettings({
      version: 1,
      'agent.sandbox.network': 'deny',
    })

    expect(migrated['agent.sandbox.enabled']).toBe(true)
    expect(migrated['agent.sandbox.network']).toBe('deny')
  })

  it('accepts custom providers with models', () => {
    const migrated = migrateVixlSettings({
      version: 1,
      'providers.custom.kat': {
        type: 'openai-compatible',
        name: 'Kat',
        baseURL: 'http://localhost:1234/v1',
        models: [
          {
            id: 'kat-coder-2.5',
            maxInputTokens: 64000,
            maxOutputTokens: 8192,
            toolCalling: true,
          },
        ],
      },
    })

    expect(migrated['providers.custom.kat']?.models?.[0]?.id).toBe('kat-coder-2.5')
    expect(migrated['providers.custom.kat']?.models?.[0]?.maxInputTokens).toBe(64000)
  })
})

describe('normalizeStoredModelRef', () => {
  it('normalizes legacy bare model ids with provider hint', () => {
    expect(normalizeStoredModelRef('claude-sonnet-4-5', 'anthropic')).toBe(
      'anthropic::claude-sonnet-4-5',
    )
  })

  it('keeps already serialized values', () => {
    expect(normalizeStoredModelRef('anthropic::claude-sonnet-4-5')).toBe(
      'anthropic::claude-sonnet-4-5',
    )
  })
})

describe('customProviderSchema', () => {
  it('validates a full custom provider', () => {
    const parsed = customProviderSchema.safeParse({
      type: 'openai-compatible',
      name: 'Local',
      baseURL: 'http://127.0.0.1:8080/v1',
      includeUsage: true,
      headers: { 'X-Test': '1' },
      models: [
        {
          id: 'model-a',
          temperature: 0.2,
          modelOptions: { foo: 'bar' },
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects invalid model temperature', () => {
    const parsed = customProviderModelSchema.safeParse({
      id: 'model-a',
      temperature: 5,
    })
    expect(parsed.success).toBe(false)
  })
})

describe('validateVixlSettings', () => {
  it('accepts valid settings', () => {
    const result = validateVixlSettings({
      version: 1,
      'appearance.theme': 'dark',
      'providers.custom.local': {
        type: 'openai-compatible',
        name: 'Local',
        baseURL: 'http://localhost:1234/v1',
      },
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid custom provider base URL', () => {
    const result = validateVixlSettings({
      version: 1,
      'providers.custom.local': {
        type: 'openai-compatible',
        name: 'Local',
        baseURL: 'not-a-url',
      },
    })
    expect(result.success).toBe(false)
  })
})

describe('providerRequiresApiKey', () => {
  it('treats custom providers as optional', () => {
    const settings = {
      version: 1 as const,
      'providers.custom.kat': {
        type: 'openai-compatible' as const,
        name: 'Kat',
        baseURL: 'http://localhost:1234/v1',
      },
    } satisfies VixlSettings

    expect(providerRequiresApiKey('kat', settings)).toBe(false)
  })

  it('still requires keys for unknown catalog providers without settings', () => {
    expect(providerRequiresApiKey('unknown-cloud')).toBe(true)
  })

  it('respects catalog requiresApiKey false', () => {
    expect(providerRequiresApiKey('ollama')).toBe(false)
  })
})

describe('resolveModelCallOptions', () => {
  const settings = {
    version: 1 as const,
    'providers.custom.kat': {
      type: 'openai-compatible' as const,
      name: 'Kat',
      baseURL: 'http://localhost:1234/v1',
      models: [
        {
          id: 'kat-coder-2.5',
          maxInputTokens: 32000,
          maxOutputTokens: 4096,
          contextWindow: 40000,
          temperature: 0.1,
          reasoningEffort: 'high',
          modelOptions: { customOption: true },
        },
      ],
    },
  } satisfies VixlSettings

  it('resolves call options from custom model config', () => {
    const options = resolveModelCallOptions(settings, {
      providerId: 'kat',
      modelId: 'kat-coder-2.5',
    })
    expect(options.maxOutputTokens).toBe(4096)
    expect(options.temperature).toBe(0.1)
    expect(options.providerOptions).toEqual({
      kat: {
        customOption: true,
        reasoningEffort: 'high',
      },
    })
  })

  it('derives max input from context window when needed', () => {
    const derivedSettings = {
      version: 1 as const,
      'providers.custom.kat': {
        type: 'openai-compatible' as const,
        name: 'Kat',
        baseURL: 'http://localhost:1234/v1',
        models: [
          {
            id: 'kat-coder-2.5',
            contextWindow: 40000,
            maxOutputTokens: 4000,
          },
        ],
      },
    } satisfies VixlSettings

    expect(
      resolveMaxInputTokens(derivedSettings, {
        providerId: 'kat',
        modelId: 'kat-coder-2.5',
      }),
    ).toBe(36000)
  })

  it('uses side-task default max output when unset', () => {
    const options = resolveSideTaskCallOptions(
      {
        version: 1,
        'providers.custom.kat': {
          type: 'openai-compatible',
          name: 'Kat',
          baseURL: 'http://localhost:1234/v1',
          models: [{ id: 'kat-coder-2.5' }],
        },
      },
      { providerId: 'kat', modelId: 'kat-coder-2.5' },
    )
    expect(options.maxOutputTokens).toBe(256)
  })

  it('falls back to defaults for non-custom models', () => {
    const options = resolveModelCallOptions(
      { version: 1 },
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' },
    )
    expect(options.maxOutputTokens).toBe(8192)
    expect(options.temperature).toBeUndefined()
    expect(options.providerOptions).toEqual({
      anthropic: {
        cacheControl: { type: 'ephemeral' },
      },
    })
  })
})
