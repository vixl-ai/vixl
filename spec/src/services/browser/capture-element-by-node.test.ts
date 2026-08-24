import { beforeEach, describe, expect, it, vi } from 'vitest'
import type CdpClient from '@/services/browser/cdp-client'
import type { BrowserElementDetail } from '@/types/browser/browser-element-detail'

const getBoxModelForObject = vi.hoisted(() =>
  vi.fn<
    (
      client: CdpClient,
      sessionId: string,
      objectId: string,
    ) => Promise<{ x: number; y: number; width: number; height: number } | null>
  >(),
)

const takeScreenshot = vi.hoisted(() =>
  vi.fn<
    (
      client: CdpClient,
      sessionId: string,
      args?: {
        fullPage?: boolean
        ref?: string
        clip?: { x: number; y: number; width: number; height: number }
      },
    ) => Promise<{ data: Uint8Array; mimeType: string }>
  >(),
)

const probeElementDom = vi.hoisted(() =>
  vi.fn<
    (
      client: CdpClient,
      sessionId: string,
      objectId: string,
    ) => Promise<{
      xpath: string
      cssSelector: string | null
      attributes: Record<string, string>
      computedStyles: Record<string, string>
      outerHTML: string | null
      innerText: string | null
      pageUrl: string | null
      ancestorPath: string | null
    }>
  >(),
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

const saveScreenshot = vi.hoisted(() =>
  vi.fn<(bytes: Uint8Array) => Promise<{ mimeType: string; path: string }>>(),
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

vi.mock('@/services/browser/cdp-geometry', () => ({
  getBoxModelForObject,
}))

vi.mock('@/services/browser/cdp-screenshot', () => ({
  takeScreenshot,
}))

vi.mock('@/services/browser/probe-element-dom', () => ({
  default: probeElementDom,
}))

vi.mock('@/services/browser/matched-styles-for-node', () => ({
  default: matchedStylesForNode,
}))

vi.mock('@/services/browser/screenshot-store', () => ({
  default: saveScreenshot,
}))

describe('captureElementByBackendNodeId', () => {
  const client = { send } as unknown as CdpClient
  const sessionId = 'sess-1'
  const backendNodeId = 42
  const screenshotBytes = new Uint8Array([1, 2, 3])

  beforeEach(() => {
    vi.clearAllMocks()

    send.mockImplementation(async (method) => {
      if (method === 'DOM.enable' || method === 'DOM.getDocument') {
        return {}
      }
      if (method === 'DOM.resolveNode') {
        return { object: { objectId: 'obj-1' } }
      }
      if (method === 'Accessibility.enable') {
        return {}
      }
      if (method === 'Accessibility.getPartialAXTree') {
        return {
          nodes: [
            {
              backendDOMNodeId: backendNodeId,
              role: { value: 'button' },
              name: { value: 'Submit' },
            },
          ],
        }
      }
      return {}
    })

    probeElementDom.mockResolvedValue({
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
    })
    matchedStylesForNode.mockResolvedValue('button.submit { color: red; }')
    getBoxModelForObject.mockResolvedValue({
      x: 10,
      y: 20,
      width: 100,
      height: 40,
    })
    takeScreenshot.mockResolvedValue({
      data: screenshotBytes,
      mimeType: 'image/png',
    })
    saveScreenshot.mockResolvedValue({
      mimeType: 'image/png',
      path: '/tmp/vixl/screenshots/element.png',
    })
  })

  it('resolves the node, probes DOM, reads AX, clips screenshot, and returns selection', async () => {
    const { default: captureElementByBackendNodeId } = await import(
      '@/services/browser/capture-element-by-node'
    )

    const selection = await captureElementByBackendNodeId(
      client,
      sessionId,
      backendNodeId,
    )

    expect(send).toHaveBeenCalledWith('DOM.enable', {}, sessionId)
    expect(send).toHaveBeenCalledWith('DOM.getDocument', { depth: 0 }, sessionId)
    expect(send).toHaveBeenCalledWith(
      'DOM.resolveNode',
      { backendNodeId },
      sessionId,
    )
    expect(probeElementDom).toHaveBeenCalledWith(client, sessionId, 'obj-1')
    expect(matchedStylesForNode).toHaveBeenCalledWith(client, sessionId, 'obj-1')
    expect(getBoxModelForObject).toHaveBeenCalledWith(client, sessionId, 'obj-1')
    expect(send).toHaveBeenCalledWith('Accessibility.enable', {}, sessionId)
    expect(send).toHaveBeenCalledWith(
      'Accessibility.getPartialAXTree',
      { backendNodeId, fetchRelatives: false },
      sessionId,
    )
    expect(takeScreenshot).toHaveBeenCalledWith(client, sessionId, {
      clip: { x: 10, y: 20, width: 100, height: 40 },
    })
    expect(saveScreenshot).toHaveBeenCalledWith(screenshotBytes)

    expect(selection.screenshotPath).toBe('/tmp/vixl/screenshots/element.png')
    expect(selection.screenshotBytes).toEqual(screenshotBytes)
    expect(selection.detail).toEqual({
      xpath: '/html[1]/body[1]/button[1]',
      cssSelector: 'button.submit',
      role: 'button',
      name: 'Submit',
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
      matchedCss: 'button.submit { color: red; }',
    } satisfies BrowserElementDetail)
  })

  it('returns selection with null boundingBox when box model is missing', async () => {
    getBoxModelForObject.mockResolvedValue(null)

    const { default: captureElementByBackendNodeId } = await import(
      '@/services/browser/capture-element-by-node'
    )

    const selection = await captureElementByBackendNodeId(
      client,
      sessionId,
      backendNodeId,
    )

    expect(takeScreenshot).toHaveBeenCalledWith(client, sessionId, {})
    expect(selection.detail.boundingBox).toBeNull()
    expect(selection.detail.xpath).toBe('/html[1]/body[1]/button[1]')
    expect(selection.detail.cssSelector).toBe('button.submit')
    expect(selection.detail.role).toBe('button')
    expect(selection.detail.name).toBe('Submit')
    expect(selection.detail.matchedCss).toBe('button.submit { color: red; }')
    expect(selection.detail.screenshotPath).toBe(
      '/tmp/vixl/screenshots/element.png',
    )
    expect(selection.screenshotPath).toBe('/tmp/vixl/screenshots/element.png')
    expect(selection.screenshotBytes).toEqual(screenshotBytes)
  })

  it('keeps matchedCss null when CSS enrichment fails', async () => {
    matchedStylesForNode.mockResolvedValue(null)

    const { default: captureElementByBackendNodeId } = await import(
      '@/services/browser/capture-element-by-node'
    )

    const selection = await captureElementByBackendNodeId(
      client,
      sessionId,
      backendNodeId,
    )

    expect(selection.detail.matchedCss).toBeNull()
    expect(selection.screenshotBytes).toEqual(screenshotBytes)
  })

  it('throws when DOM.resolveNode yields no objectId', async () => {
    send.mockImplementation(async (method) => {
      if (method === 'DOM.enable' || method === 'DOM.getDocument') {
        return {}
      }
      if (method === 'DOM.resolveNode') {
        return { object: {} }
      }
      return {}
    })

    const { default: captureElementByBackendNodeId } = await import(
      '@/services/browser/capture-element-by-node'
    )

    await expect(
      captureElementByBackendNodeId(client, sessionId, backendNodeId),
    ).rejects.toThrow(/Failed to resolve DOM node/)
  })
})
