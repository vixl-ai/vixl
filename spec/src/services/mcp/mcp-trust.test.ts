import { beforeEach, describe, expect, it } from 'vitest'
import connectionKey from '@/services/mcp/connection-key'
import {
  isMcpTrusted,
  sessionTrusts,
  upsertMcpTrustRecord,
} from '@/services/mcp/mcp-trust'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const emptySettings = (): VixlSettings => ({ version: 1 })

describe('isMcpTrusted', () => {
  beforeEach(() => {
    sessionTrusts.clear()
  })

  it('does not trust a composite session entry for a different scope', () => {
    const fingerprint = 'fp-github'
    sessionTrusts.set(connectionKey('/tmp/project-a', 'github'), fingerprint)

    expect(
      isMcpTrusted(emptySettings(), 'github', fingerprint, sessionTrusts, '/tmp/project-a'),
    ).toBe(true)
    expect(
      isMcpTrusted(emptySettings(), 'github', fingerprint, sessionTrusts, '/tmp/project-b'),
    ).toBe(false)
    expect(
      isMcpTrusted(emptySettings(), 'github', fingerprint, sessionTrusts, 'personal'),
    ).toBe(false)
  })

  it('does not fall back to a bare serverId session entry', () => {
    const fingerprint = 'fp-github'
    sessionTrusts.set('github', fingerprint)

    expect(
      isMcpTrusted(emptySettings(), 'github', fingerprint, sessionTrusts, '/tmp/project-a'),
    ).toBe(false)
    expect(
      isMcpTrusted(emptySettings(), 'github', fingerprint, sessionTrusts, 'personal'),
    ).toBe(false)
    expect(isMcpTrusted(emptySettings(), 'github', fingerprint, sessionTrusts)).toBe(false)
  })

  it('still honors persistent always trust by server id', () => {
    const settings: VixlSettings = {
      version: 1,
      'agent.mcp.trust': upsertMcpTrustRecord([], 'github', 'always', 'fp-github'),
    }

    expect(isMcpTrusted(settings, 'github', 'fp-github', sessionTrusts, '/tmp/project-b')).toBe(
      true,
    )
    expect(isMcpTrusted(settings, 'github', 'fp-other', sessionTrusts, '/tmp/project-a')).toBe(
      false,
    )
  })
})
