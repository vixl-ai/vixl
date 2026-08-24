import { beforeEach, describe, expect, it, vi } from 'vitest'
import type CdpClient from '@/services/browser/cdp-client'
import type { BrowserElementDetail } from '@/types/browser/browser-element-detail'
import { DESKTOP_CHROME_USER_AGENT_DATA } from '@/services/browser/desktop-chrome-user-agent'

const getSessionCdpClient = vi.hoisted(() =>
  vi.fn<(sessionId: string) => Promise<CdpClient>>(),
)

const resolveSessionIdForWorkspace = vi.hoisted(() =>
  vi.fn<(workspaceId: string, sessionId?: string) => string | null>(),
)

const getLastInteractedViewId = vi.hoisted(() =>
  vi.fn<(workspaceId: string) => string | null>(),
)

const listTabs = vi.hoisted(() => vi.fn<(workspaceId: string) => Array<{ viewId: string }>>())

const applyUserAgentOverride = vi.hoisted(() =>
  vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
)

const resolveRef = vi.hoisted(() =>
  vi.fn<
    (
      client: CdpClient,
      sessionId: string,
      ref: string,
    ) => Promise<{ backendNodeId: number; objectId: string } | null>
  >(),
)

const getSnapshotNode = vi.hoisted(() =>
  vi.fn<(sessionId: string, ref: string) => { role: string | null; name: string | null } | null>(),
)

const getBoundingBox = vi.hoisted(() =>
  vi.fn<
    (
      client: CdpClient,
      sessionId: string,
      ref: string,
    ) => Promise<{ x: number; y: number; width: number; height: number } | null>
  >(),
)

const takeScreenshot = vi.hoisted(() =>
  vi.fn<
    (
      client: CdpClient,
      sessionId: string,
      args?: { fullPage?: boolean; ref?: string },
    ) => Promise<{ data: Uint8Array; mimeType: string }>
  >(),
)

const saveScreenshot = vi.hoisted(() =>
  vi.fn<(bytes: Uint8Array) => Promise<{ mimeType: string; path: string }>>(),
)

const matchedStylesForNode = vi.hoisted(() =>
  vi.fn<
    (
      client: CdpClient,
      sessionId: string,
      objectId: string,
    ) => Promise<string | null>
  >(),
)

const send = vi.hoisted(() =>
  vi.fn<
    (
      method: string,
      params?: Record<string, unknown>,
      sessionId?: string,
    ) => Promise<unknown>
  >(),
)

vi.mock('@/services/browser/registry', () => ({
  getSessionCdpClient,
  resolveSessionIdForWorkspace,
  getLastInteractedViewId,
  listTabs,
}))

vi.mock('@/services/browser/cdp-user-agent', () => ({
  applyUserAgentOverride,
}))

vi.mock('@/services/browser/cdp-ops', () => ({
  resolveRef,
  getSnapshotNode,
  getBoundingBox,
  takeScreenshot,
}))

vi.mock('@/services/browser/screenshot-store', () => ({
  default: saveScreenshot,
}))

vi.mock('@/services/browser/matched-styles-for-node', () => ({
  default: matchedStylesForNode,
}))

describe('design-mode-select', () => {
  const client = { send } as unknown as CdpClient
  const screenshotBytes = new Uint8Array([1, 2, 3])

  beforeEach(() => {
    vi.clearAllMocks()
    resolveSessionIdForWorkspace.mockReturnValue('cef-1')
    getLastInteractedViewId.mockReturnValue('cef-1')
    listTabs.mockReturnValue([{ viewId: 'cef-1' }])
    getSessionCdpClient.mockResolvedValue(client)
    resolveRef.mockResolvedValue({ backendNodeId: 42, objectId: 'obj-1' })
    getSnapshotNode.mockReturnValue({ role: 'button', name: 'Submit' })
    getBoundingBox.mockResolvedValue({ x: 10, y: 20, width: 100, height: 40 })
    takeScreenshot.mockResolvedValue({
      data: screenshotBytes,
      mimeType: 'image/png',
    })
    saveScreenshot.mockResolvedValue({
      mimeType: 'image/png',
      path: '/tmp/vixl/screenshots/element.png',
    })
    matchedStylesForNode.mockResolvedValue('button.submit { color: navy; }')

    send.mockResolvedValue({
      result: {
        value: {
          xpath: '/html[1]/body[1]/button[1]',
          cssSelector: 'button.submit',
          attributes: { type: 'submit', class: 'submit' },
          computedStyles: {
            display: 'inline-block',
            position: 'static',
            color: 'rgb(0, 0, 0)',
            backgroundColor: 'rgb(255, 255, 255)',
            fontSize: '14px',
            fontFamily: 'sans-serif',
            width: '100px',
            height: '40px',
            margin: '0px',
            padding: '8px',
          },
          outerHTML: '<button class="submit" type="submit">Submit</button>',
          innerText: 'Submit',
          pageUrl: 'https://example.com/form',
          ancestorPath: 'button.submit > form#main > body > html',
        },
      },
    })
  })

  it('returns BrowserElementSelection with detail, screenshotPath, and screenshotBytes', async () => {
    const { default: captureElementSelection } = await import(
      '@/services/browser/design-mode-select'
    )

    const selection = await captureElementSelection('ws-1', 'ref-1')

    expect(getSessionCdpClient).toHaveBeenCalledWith('cef-1')
    expect(applyUserAgentOverride).toHaveBeenCalledWith(
      client,
      '',
      expect.any(String),
      DESKTOP_CHROME_USER_AGENT_DATA,
    )
    expect(resolveRef).toHaveBeenCalledWith(client, '', 'ref-1')
    expect(takeScreenshot).toHaveBeenCalledWith(client, '', { ref: 'ref-1' })
    expect(saveScreenshot).toHaveBeenCalledWith(screenshotBytes)
    expect(matchedStylesForNode).toHaveBeenCalledWith(client, '', 'obj-1')

    expect(selection.screenshotPath).toBe('/tmp/vixl/screenshots/element.png')
    expect(selection.screenshotBytes).toEqual(screenshotBytes)
    expect(selection.detail).toEqual({
      xpath: '/html[1]/body[1]/button[1]',
      role: 'button',
      name: 'Submit',
      cssSelector: 'button.submit',
      attributes: { type: 'submit', class: 'submit' },
      boundingBox: { x: 10, y: 20, width: 100, height: 40 },
      computedStyles: {
        display: 'inline-block',
        position: 'static',
        color: 'rgb(0, 0, 0)',
        backgroundColor: 'rgb(255, 255, 255)',
        fontSize: '14px',
        fontFamily: 'sans-serif',
        width: '100px',
        height: '40px',
        margin: '0px',
        padding: '8px',
      },
      componentHint: null,
      screenshotPath: '/tmp/vixl/screenshots/element.png',
      outerHTML: '<button class="submit" type="submit">Submit</button>',
      innerText: 'Submit',
      pageUrl: 'https://example.com/form',
      ancestorPath: 'button.submit > form#main > body > html',
      matchedCss: 'button.submit { color: navy; }',
    } satisfies BrowserElementDetail)
  })

  it('throws when the ref cannot be resolved', async () => {
    resolveRef.mockResolvedValue(null)
    const { default: captureElementSelection } = await import(
      '@/services/browser/design-mode-select'
    )

    await expect(captureElementSelection('ws-1', 'missing-ref')).rejects.toThrow(
      /Unknown ref/,
    )
  })
})
