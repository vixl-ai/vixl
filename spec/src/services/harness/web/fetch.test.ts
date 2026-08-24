import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const gateToolPermission = vi.hoisted(() =>
  vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
)

const webFetch = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => Promise<unknown>>(),
)

const convertWebContent = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => unknown>(),
)

vi.mock('@/services/harness/permission/gate', () => ({
  gateToolPermission,
}))

vi.mock('@/services/vixl/vixl-tauri/web-fetch', () => ({
  default: webFetch,
}))

vi.mock('@/services/harness/web/convert', () => ({
  default: convertWebContent,
}))

import webFetchTool from '@/services/harness/web/fetch'
import webFetchSessionCache from '@/services/harness/web/session-cache'

const baseCtx = (): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
})

const execute = async (
  input: Record<string, unknown>,
  ctx: HarnessToolContext = baseCtx(),
): Promise<unknown> => {
  const built = webFetchTool(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('web_fetch tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    webFetchSessionCache.clear()
    gateToolPermission.mockResolvedValue(true)
    convertWebContent.mockReturnValue({
      ok: true,
      text: 'Converted article body',
      kind: 'markdown',
      spaShell: false,
      challenge: false,
    })
    webFetch.mockResolvedValue({
      status: 200,
      body: '<html><body><h1>Hi</h1></body></html>',
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  })

  it('rejects when permission is denied', async () => {
    gateToolPermission.mockResolvedValue(false)
    const result = await execute({ url: 'https://example.com' })
    expect(result).toEqual({ rejected: true, error: 'Web fetch denied' })
    expect(webFetch).not.toHaveBeenCalled()
  })

  it('wraps 200 HTML as untrusted content and supports truncation pagination', async () => {
    convertWebContent.mockReturnValue({
      ok: true,
      text: 'ABCDEFGHIJ',
      kind: 'markdown',
      spaShell: false,
      challenge: false,
    })

    const result = (await execute({
      url: 'https://example.com/docs',
      max_length: 4,
      start_index: 0,
    })) as Record<string, unknown>

    expect(result.status).toBe(200)
    expect(result.contentType).toBe('text/html; charset=utf-8')
    expect(result.truncated).toBe(true)
    expect(result.nextStartIndex).toBe(4)
    expect(String(result.text)).toContain(
      'Untrusted web content from https://example.com/docs',
    )
    expect(String(result.text)).toContain('ABCD')
    expect(String(result.text)).not.toContain('EFGHIJ')
  })

  it('returns redirect metadata without converting the body as the page', async () => {
    webFetch.mockResolvedValue({
      status: 302,
      body: '<html><body>redirect interstitial</body></html>',
      headers: { Location: 'https://example.com/final' },
    })

    const result = (await execute({
      url: 'https://example.com/old',
    })) as Record<string, unknown>

    expect(result.status).toBe(302)
    expect(result.location).toBe('https://example.com/final')
    expect(String(result.error)).toContain('Redirects are not followed')
    expect(convertWebContent).not.toHaveBeenCalled()
  })

  it('caches converted text so a second call skips Tauri fetch', async () => {
    await execute({ url: 'https://example.com/cached', format: 'markdown' })
    await execute({ url: 'https://example.com/cached', format: 'markdown' })

    expect(webFetch).toHaveBeenCalledTimes(1)
  })

  it('surfaces a browser hint for SPA shell or challenge pages', async () => {
    convertWebContent.mockReturnValue({
      ok: true,
      text: 'Loading...',
      kind: 'markdown',
      spaShell: true,
      challenge: false,
    })

    const result = (await execute({
      url: 'https://spa.example.com',
    })) as Record<string, unknown>

    expect(result.spaShell).toBe(true)
    expect(String(result.hint)).toContain('browser_snapshot')
  })

  it('fetches github.com URLs (not blocked)', async () => {
    const result = (await execute({
      url: 'https://github.com/owner/repo',
    })) as Record<string, unknown>

    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'web.fetch:github.com',
        action: 'web.fetch',
        kind: 'web',
      }),
    )
    expect(webFetch).toHaveBeenCalledWith({
      url: 'https://github.com/owner/repo',
      format: 'markdown',
    })
    expect(result.rejected).toBeUndefined()
    expect(String(result.text)).toContain('github.com/owner/repo')
  })

  it('returns an error for invalid URLs', async () => {
    const result = await execute({ url: 'not a url' })
    expect(result).toEqual({ error: 'Invalid URL' })
    expect(webFetch).not.toHaveBeenCalled()
  })
})
