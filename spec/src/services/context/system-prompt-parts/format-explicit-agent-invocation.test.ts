import { describe, expect, it } from 'vitest'
import formatExplicitAgentInvocation from '@/services/context/system-prompt-parts/format-explicit-agent-invocation'
import buildMentionInjectionText from '@/services/context/system-prompt-parts/build-mention-injection-text'

describe('formatExplicitAgentInvocation', () => {
  it('builds a trusted per-turn spawn instruction from agent mentions', () => {
    const text = formatExplicitAgentInvocation([{ type: 'agent', name: 'reviewer' }])
    expect(text).toContain('The user explicitly invoked these subagents: reviewer')
    expect(text).toContain('Call spawn_subagent once per name')
    expect(text).toContain('agentName set to that catalog name exactly')
  })

  it('returns empty when no agent mentions are present', () => {
    expect(formatExplicitAgentInvocation([{ type: 'skill', name: 'ask' }])).toBe('')
  })
})

describe('buildMentionInjectionText', () => {
  it('puts the trusted invocation above untrusted file context', () => {
    const text = buildMentionInjectionText([
      { type: 'agent', name: 'reviewer' },
      { type: 'file', path: 'src/auth.ts', content: 'export const auth = 1' },
    ])
    expect(text).toContain('explicitly invoked these subagents: reviewer')
    expect(text).toContain('Context:\nFile src/auth.ts:')
    expect(text).not.toContain('Skill reviewer')
    expect(text.indexOf('explicitly invoked')).toBeLessThan(text.indexOf('Context:'))
  })

  it('includes Skill name lines when a skill mention is present', () => {
    const text = buildMentionInjectionText([
      { type: 'skill', name: 'create-rule' },
      { type: 'file', path: 'src/auth.ts', content: 'export const auth = 1' },
    ])
    expect(text).toContain('Skill create-rule')
    expect(text).not.toContain('Call load_skill')
    expect(text).not.toContain('before acting')
    expect(text).toContain('Context:')
    expect(text).toContain('File src/auth.ts:')
    expect(text).not.toContain('Available skills:')
  })
})
