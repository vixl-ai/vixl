import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpStdioServer } from '@/types/vixl/mcp-config'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const deleteSecret = vi.hoisted(() =>
  vi.fn<(key: string) => Promise<void>>(async () => undefined),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    deleteSecret,
  }),
)

import {
  assertServerTrusted,
  clearServerSecrets,
} from '@/services/mcp/mcp-runtime/trust'

const stdioConfig: McpStdioServer = {
  command: 'npx',
  args: ['server'],
  env: {
    API_KEY: '${input:apiKey}',
  },
}

describe('mcp-runtime trust', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('clears known secrets for a server', async () => {
    await clearServerSecrets('demo', stdioConfig)
    expect(deleteSecret.mock.calls.length).toBeGreaterThan(0)
  })

  it('skips trust when skipTrustCheck is set', () => {
    expect(() =>
      assertServerTrusted('demo', stdioConfig, { skipTrustCheck: true }),
    ).not.toThrow()
  })

  it('requires settings when trust must be checked', () => {
    expect(() => assertServerTrusted('demo', stdioConfig)).toThrow(
      /requires settings/,
    )
  })

  it('rejects untrusted servers', () => {
    expect(() =>
      assertServerTrusted('demo', stdioConfig, {
        settings: {
          version: 1,
          appearance: { theme: 'system' },
          providers: {},
          permissions: {
            dial: 'ask',
            autoApprove: {
              read: false,
              write: false,
              shell: false,
              network: false,
              mcp: false,
            },
          },
          mcp: { trusted: {} },
        } as never,
      }),
    ).toThrow(/not trusted/)
  })
})
