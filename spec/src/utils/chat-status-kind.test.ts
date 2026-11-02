import { describe, expect, it } from 'vitest'
import { chatStatusKind } from '@/utils/chat-status-kind'

describe('chatStatusKind', () => {
  it('lets running beat disconnected', () => {
    expect(
      chatStatusKind({
        status: 'running',
        attention: 'disconnected',
        sshDisconnected: true,
      }).kind,
    ).toBe('running')
  })

  it('lets needs input beat disconnected', () => {
    expect(
      chatStatusKind({
        status: 'idle',
        attention: 'needs_input',
        sshDisconnected: true,
      }),
    ).toEqual({ kind: 'needs_input', label: 'Needs input' })
    expect(
      chatStatusKind({
        status: 'idle',
        attention: 'disconnected',
        sshDisconnected: true,
        sshNeedsInput: true,
      }),
    ).toEqual({ kind: 'needs_input', label: 'Needs input' })
  })

  it('lets needs approval and needs mcp auth beat disconnected', () => {
    expect(
      chatStatusKind({
        attention: 'needs_approval',
        sshDisconnected: true,
      }).kind,
    ).toBe('needs_approval')
    expect(
      chatStatusKind({
        attention: 'needs_mcp_auth',
        sshDisconnected: true,
      }).kind,
    ).toBe('needs_mcp_auth')
  })

  it('lets disconnected beat done and error', () => {
    expect(
      chatStatusKind({
        attention: 'completed',
        sshDisconnected: true,
      }),
    ).toEqual({ kind: 'disconnected', label: 'Disconnected' })
    expect(
      chatStatusKind({
        attention: 'error',
        sshDisconnected: true,
      }),
    ).toEqual({ kind: 'disconnected', label: 'Disconnected' })
  })
})
