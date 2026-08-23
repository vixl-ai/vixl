import { describe, expect, it } from 'vitest'
import {
  decidePermission,
  isStickyShellElevation,
} from '@/services/harness/permission/policy'
import type { PyrolaSettings } from '@/types/pyrola/pyrola-settings'

const baseSettings = (
  permissions: PyrolaSettings['agent.permissions'] = [],
): PyrolaSettings =>
  ({
    version: 1,
    'agent.permissions': permissions,
  }) as PyrolaSettings

describe('decidePermission web.fetch', () => {
  it('asks by default', () => {
    const decision = decidePermission({
      action: 'web.fetch',
      capability: 'web.fetch:example.com',
      settings: baseSettings(),
      permissionLevel: 'ask',
      sessionAllows: new Set(),
      sessionDenies: new Set(),
      sandboxEnabled: true,
    })

    expect(decision.verdict).toBe('ask')
    expect(decision.allowedScopes).toEqual([
      'once',
      'session',
      'workspace',
      'always',
      'never',
    ])
  })

  it('does not auto-allow under bypass', () => {
    const decision = decidePermission({
      action: 'web.fetch',
      capability: 'web.fetch:example.com',
      settings: baseSettings(),
      permissionLevel: 'bypass',
      sessionAllows: new Set(),
      sessionDenies: new Set(),
      sandboxEnabled: true,
    })

    expect(decision.verdict).toBe('ask')
  })

  it('allows when sessionAllows has web.fetch:host', () => {
    const decision = decidePermission({
      action: 'web.fetch',
      capability: 'web.fetch:example.com',
      settings: baseSettings(),
      permissionLevel: 'ask',
      sessionAllows: new Set(['web.fetch:example.com']),
      sessionDenies: new Set(),
      sandboxEnabled: true,
    })

    expect(decision.verdict).toBe('allow')
  })

  it('allows when sessionAllows has broad web.fetch', () => {
    const decision = decidePermission({
      action: 'web.fetch',
      capability: 'web.fetch:example.com',
      settings: baseSettings(),
      permissionLevel: 'ask',
      sessionAllows: new Set(['web.fetch']),
      sessionDenies: new Set(),
      sandboxEnabled: true,
    })

    expect(decision.verdict).toBe('allow')
  })

  it('allows when persisted allow exists', () => {
    const decision = decidePermission({
      action: 'web.fetch',
      capability: 'web.fetch:example.com',
      settings: baseSettings([
        {
          capability: 'web.fetch:example.com',
          verdict: 'allow',
          scope: 'workspace',
        },
      ]),
      permissionLevel: 'ask',
      sessionAllows: new Set(),
      sessionDenies: new Set(),
      sandboxEnabled: true,
    })

    expect(decision.verdict).toBe('allow')
  })
})

const shellInput = (
  action: 'shell' | 'shell.network' | 'shell.unsandboxed',
  sessionAllows: string[],
  sandboxEnabled = true,
) => ({
  action,
  capability: action,
  settings: baseSettings(),
  permissionLevel: 'ask' as const,
  sessionAllows: new Set(sessionAllows),
  sessionDenies: new Set<string>(),
  sandboxEnabled,
})

describe('decidePermission shell', () => {
  it('asks for sandboxed shell by default', () => {
    const decision = decidePermission(shellInput('shell', []))
    expect(decision.verdict).toBe('ask')
    expect(decision.allowedScopes).toEqual(['once', 'session', 'never'])
  })

  it('allows sandboxed shell when sessionAllows has shell', () => {
    const decision = decidePermission(shellInput('shell', ['shell']))
    expect(decision.verdict).toBe('allow')
  })

  it('does not let session allow of shell cover shell.unsandboxed', () => {
    const decision = decidePermission(shellInput('shell.unsandboxed', ['shell']))
    expect(decision.verdict).toBe('ask')
    expect(decision.allowedScopes).toEqual(['once', 'session', 'never'])
  })

  it('allows shell.unsandboxed when sessionAllows has shell.unsandboxed', () => {
    const decision = decidePermission(
      shellInput('shell.unsandboxed', ['shell.unsandboxed']),
    )
    expect(decision.verdict).toBe('allow')
  })

  it('lets session allow of shell.unsandboxed cover sandboxed shell', () => {
    const decision = decidePermission(shellInput('shell', ['shell.unsandboxed']))
    expect(decision.verdict).toBe('allow')
  })

  it('asks with unsandboxed reason when sandbox is off', () => {
    const decision = decidePermission(shellInput('shell.unsandboxed', [], false))
    expect(decision.verdict).toBe('ask')
    expect(decision.reason).toBe('Unsandboxed shell')
  })

  it('does not let session allow of shell cover shell.network', () => {
    const decision = decidePermission(shellInput('shell.network', ['shell']))
    expect(decision.verdict).toBe('ask')
    expect(decision.allowedScopes).toEqual(['once', 'session', 'never'])
  })

  it('allows shell.network when sessionAllows has shell.network', () => {
    const decision = decidePermission(shellInput('shell.network', ['shell.network']))
    expect(decision.verdict).toBe('allow')
  })

  it('lets session allow of shell.unsandboxed cover shell.network', () => {
    const decision = decidePermission(
      shellInput('shell.network', ['shell.unsandboxed']),
    )
    expect(decision.verdict).toBe('allow')
  })

  it('does not let session allow of shell.network cover shell.unsandboxed', () => {
    const decision = decidePermission(
      shellInput('shell.unsandboxed', ['shell.network']),
    )
    expect(decision.verdict).toBe('ask')
  })
})

describe('isStickyShellElevation', () => {
  it('is true only for network and unsandboxed hops', () => {
    expect(isStickyShellElevation('shell.network')).toBe(true)
    expect(isStickyShellElevation('shell.unsandboxed')).toBe(true)
    expect(isStickyShellElevation('shell')).toBe(false)
    expect(isStickyShellElevation('web.fetch')).toBe(false)
  })
})
