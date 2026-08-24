import { describe, expect, it } from 'vitest'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const settings = {
  version: 1,
  'models.default': 'anthropic::claude-sonnet-4-5',
  'models.agent': 'openai::gpt-4o',
  'models.title': 'google::gemini-2.0-flash',
} as VixlSettings

describe('resolveModelForRole', () => {
  it('prefers chat override', () => {
    expect(resolveModelForRole('agent', settings, 'gateway::openai/gpt-4o-mini')).toBe(
      'gateway::openai/gpt-4o-mini',
    )
  })

  it('uses role-specific settings before default', () => {
    expect(resolveModelForRole('agent', settings)).toBe('openai::gpt-4o')
    expect(resolveModelForRole('ask', settings)).toBe('anthropic::claude-sonnet-4-5')
  })

  it('resolves background task roles', () => {
    expect(resolveModelForRole('title', settings)).toBe('google::gemini-2.0-flash')
    expect(resolveModelForRole('compaction', settings)).toBe('anthropic::claude-sonnet-4-5')
  })

  it('resolves subagent with agent fallback', () => {
    expect(resolveModelForRole('subagent', settings)).toBe('openai::gpt-4o')
  })
})
