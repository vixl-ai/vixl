import { describe, expect, it } from 'vitest'
import {
  approvalActionSpecs,
  isNetworkSandboxApproval,
  onceApprovalLabel,
  orderedApprovalScopes,
  prefersSessionApproval,
} from '@/components/chat/chat-tool-card'

describe('onceApprovalLabel', () => {
  it('uses Allow once for sandboxed approvals', () => {
    expect(onceApprovalLabel()).toBe('Allow once')
    expect(onceApprovalLabel(false)).toBe('Allow once')
  })

  it('uses Allow network in sandbox for the network hop', () => {
    expect(onceApprovalLabel(false, true)).toBe('Allow network in sandbox')
  })

  it('uses Run outside sandbox when the approval is unsandboxed', () => {
    expect(onceApprovalLabel(true)).toBe('Run outside sandbox')
    expect(onceApprovalLabel(true, true)).toBe('Run outside sandbox')
  })
})

describe('isNetworkSandboxApproval', () => {
  it('matches the network runtime blocked detail', () => {
    expect(
      isNetworkSandboxApproval(
        'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (network denied).',
      ),
    ).toBe(true)
    expect(
      isNetworkSandboxApproval(
        'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (isolated devices).',
      ),
    ).toBe(false)
  })
})

describe('orderedApprovalScopes', () => {
  const scopes = ['once', 'session', 'never'] as const

  it('keeps once first for ordinary sandboxed shell', () => {
    expect(prefersSessionApproval(false)).toBe(false)
    expect(orderedApprovalScopes([...scopes], false)).toEqual(['once', 'session'])
  })

  it('puts session first for the network hop', () => {
    const detail =
      'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (network denied).'
    expect(prefersSessionApproval(false, detail)).toBe(true)
    expect(orderedApprovalScopes([...scopes], false, detail)).toEqual([
      'session',
      'once',
    ])
  })

  it('puts session first for unsandboxed approvals', () => {
    expect(prefersSessionApproval(true)).toBe(true)
    expect(orderedApprovalScopes([...scopes], true)).toEqual(['session', 'once'])
  })
})

describe('approvalActionSpecs', () => {
  it('uses tooltip labels and a deny action for ghost buttons', () => {
    expect(
      approvalActionSpecs({
        allowedScopes: ['once', 'session', 'never'],
        unsandboxed: false,
      }),
    ).toEqual([
      { key: 'once', tooltip: 'Allow once', tone: 'default' },
      { key: 'session', tooltip: 'Allow session', tone: 'default' },
      { key: 'deny', tooltip: 'Deny', tone: 'default' },
      { key: 'never', tooltip: 'Never', tone: 'danger' },
    ])
  })

  it('labels the once action for unsandboxed and network hops', () => {
    const unsandboxed = approvalActionSpecs({
      allowedScopes: ['once', 'session'],
      unsandboxed: true,
    })
    expect(unsandboxed.find((action) => action.key === 'once')?.tooltip).toBe(
      'Run outside sandbox',
    )
    const network = approvalActionSpecs({
      allowedScopes: ['once', 'session'],
      unsandboxed: false,
      detail: 'SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (network denied).',
    })
    expect(network.find((action) => action.key === 'once')?.tooltip).toBe(
      'Allow network in sandbox',
    )
  })
})
