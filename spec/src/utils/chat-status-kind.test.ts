import { describe, expect, it } from 'vitest'
import { chatStatusKind } from '@/utils/chat-status-kind'

describe('chatStatusKind', () => {
  it('lets running beat disconnected', () => {
    expect(
      chatStatusKind({
        status: 'running',
        attention: 'disconnected',
      }).kind,
    ).toBe('running')
  })

  it('lets blocked-on-user attention beat running', () => {
    expect(
      chatStatusKind({ status: 'running', attention: 'needs_approval' }),
    ).toEqual({ kind: 'needs_approval', label: 'Needs approval' })
    expect(
      chatStatusKind({ status: 'running', attention: 'needs_input' }),
    ).toEqual({ kind: 'needs_input', label: 'Needs input' })
    expect(
      chatStatusKind({ status: 'running', attention: 'needs_mcp_auth' }),
    ).toEqual({ kind: 'needs_mcp_auth', label: 'Needs MCP auth' })
  })

  it('keeps running over ssh needs input', () => {
    expect(
      chatStatusKind({ status: 'running', sshNeedsInput: true }).kind,
    ).toBe('running')
  })

  it('lets needs input beat disconnected', () => {
    expect(
      chatStatusKind({
        status: 'idle',
        attention: 'needs_input',
      }),
    ).toEqual({ kind: 'needs_input', label: 'Needs input' })
    expect(
      chatStatusKind({
        status: 'idle',
        attention: 'disconnected',
        sshNeedsInput: true,
      }),
    ).toEqual({ kind: 'needs_input', label: 'Needs input' })
  })

  it('lets needs approval and needs mcp auth beat disconnected', () => {
    expect(
      chatStatusKind({
        attention: 'needs_approval',
      }).kind,
    ).toBe('needs_approval')
    expect(
      chatStatusKind({
        attention: 'needs_mcp_auth',
      }).kind,
    ).toBe('needs_mcp_auth')
  })

  it('keeps done and error on the chat', () => {
    expect(
      chatStatusKind({
        attention: 'completed',
      }),
    ).toEqual({ kind: 'completed', label: 'Done' })
    expect(
      chatStatusKind({
        attention: 'error',
      }),
    ).toEqual({ kind: 'error', label: 'Error' })
  })

  it('reports disconnected only from the chat attention', () => {
    expect(
      chatStatusKind({
        attention: 'disconnected',
      }),
    ).toEqual({ kind: 'disconnected', label: 'Disconnected' })
  })
})
