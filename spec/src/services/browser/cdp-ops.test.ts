import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import type CdpClient from '@/services/browser/cdp-client'

const writeTempBytes = vi.hoisted(() =>
  vi.fn<(args: {
    contentBase64: string
    kind: string
    extension: string
  }) => Promise<{ path: string; filename: string }>>(),
)

const appendTempLog = vi.hoisted(() =>
  vi.fn<(args: {
    path?: string | null
    kind: string
    line: string
  }) => Promise<{ path: string; filename: string }>>(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    writeTempBytes,
    appendTempLog,
  }),
)

type FakeHandler = (params: unknown, sessionId?: string) => void

const createFakeClient = () => {
  const handlers = new Map<string, Set<FakeHandler>>()
  const send = vi.fn<
    (method: string, params?: Record<string, unknown>, sessionId?: string) => Promise<unknown>
  >(async () => ({}))
  const on = vi.fn<(method: string, handler: FakeHandler) => () => void>((method, handler) => {
    let set = handlers.get(method)
    if (!set) {
      set = new Set()
      handlers.set(method, set)
    }
    set.add(handler)
    return () => {
      set?.delete(handler)
    }
  })
  const attachToTarget = vi.fn<(targetId: string) => Promise<{ sessionId: string }>>(
    async (targetId) => ({
      sessionId: `session-for-${targetId}`,
    }),
  )
  const close = vi.fn<() => void>()

  const emit = (method: string, params: unknown, sessionId?: string): void => {
    const set = handlers.get(method)
    if (!set) {
      return
    }
    for (const handler of set) {
      handler(params, sessionId)
    }
  }

  const client = {
    send,
    on,
    attachToTarget,
    close,
  } as unknown as CdpClient

  return { client, send, on, attachToTarget, emit }
}

describe('cdp-ops', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    writeTempBytes.mockResolvedValue({
      path: '/tmp/vixl/screenshots/shot.png',
      filename: 'shot.png',
    })
    appendTempLog.mockImplementation(async (args) => ({
      path: args.path ?? `/tmp/vixl/${args.kind}/capture.log`,
      filename: 'capture.log',
    }))

    const { resetBrowserRegistryForTests } = await import('@/services/browser/registry')
    resetBrowserRegistryForTests()
    const { resetCdpOpsForTests } = await import('@/services/browser/cdp-ops')
    resetCdpOpsForTests()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('navigate calls Page.enable then Page.navigate and resolves after loadEventFired', async () => {
    const { client, send, emit } = createFakeClient()
    send.mockImplementation(async (method) => {
      if (method === 'Page.enable') {
        return {}
      }
      if (method === 'Page.navigate') {
        queueMicrotask(() => {
          emit('Page.loadEventFired', {}, 'sess-1')
        })
        return { frameId: 'frame-1', loaderId: 'loader-1' }
      }
      return {}
    })

    const { navigate } = await import('@/services/browser/cdp-ops')
    const result = await navigate(client, 'sess-1', 'https://example.com')

    expect(send.mock.calls.map((call) => call[0])).toEqual(['Page.enable', 'Page.navigate'])
    expect(send).toHaveBeenNthCalledWith(1, 'Page.enable', {}, 'sess-1')
    expect(send).toHaveBeenNthCalledWith(
      2,
      'Page.navigate',
      { url: 'https://example.com' },
      'sess-1',
    )
    expect(result).toEqual({ frameId: 'frame-1', loaderId: 'loader-1' })
  })

  it('getAccessibilitySnapshot builds a tree from flat AX nodes', async () => {
    const { client, send } = createFakeClient()
    send.mockImplementation(async (method) => {
      if (method === 'Accessibility.enable') {
        return {}
      }
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            {
              nodeId: '1',
              role: { type: 'role', value: 'RootWebArea' },
              name: { type: 'string', value: 'Page' },
              childIds: ['2', '3'],
            },
            {
              nodeId: '2',
              role: { type: 'role', value: 'button' },
              name: { type: 'string', value: 'Go' },
              parentId: '1',
              backendDOMNodeId: 42,
              childIds: [],
            },
            {
              nodeId: '3',
              role: { type: 'role', value: 'textbox' },
              name: { type: 'string', value: 'Query' },
              parentId: '1',
              backendDOMNodeId: 43,
              childIds: [],
            },
          ],
        }
      }
      return {}
    })

    const { getAccessibilitySnapshot } = await import('@/services/browser/cdp-ops')
    const snapshot = await getAccessibilitySnapshot(client, 'sess-1')

    expect(snapshot.snapshotId).toEqual(expect.any(String))
    expect(snapshot.nodes).toHaveLength(1)
    expect(snapshot.nodes[0]).toMatchObject({
      ref: '1',
      role: 'RootWebArea',
      name: 'Page',
    })
    expect(snapshot.nodes[0]?.children).toEqual([
      {
        ref: '2',
        role: 'button',
        name: 'Go',
        children: [],
        backendDOMNodeId: 42,
      },
      {
        ref: '3',
        role: 'textbox',
        name: 'Query',
        children: [],
        backendDOMNodeId: 43,
      },
    ])
  })

  it('click resolves ref, gets box model, and dispatches mouse events', async () => {
    const { client, send } = createFakeClient()
    send.mockImplementation(async (method) => {
      if (method === 'Accessibility.enable') {
        return {}
      }
      if (method === 'Accessibility.getFullAXTree') {
        return {
          nodes: [
            {
              nodeId: 'btn',
              role: { value: 'button' },
              name: { value: 'Click me' },
              backendDOMNodeId: 99,
              childIds: [],
            },
          ],
        }
      }
      if (method === 'DOM.resolveNode') {
        return { object: { objectId: 'obj-1' } }
      }
      if (method === 'DOM.getBoxModel') {
        return {
          model: {
            border: [10, 20, 50, 20, 50, 60, 10, 60],
            width: 40,
            height: 40,
          },
        }
      }
      if (method === 'Input.dispatchMouseEvent') {
        return {}
      }
      return {}
    })

    const { getAccessibilitySnapshot, click } = await import('@/services/browser/cdp-ops')
    await getAccessibilitySnapshot(client, 'sess-1')
    await click(client, 'sess-1', 'btn')

    expect(send).toHaveBeenCalledWith('DOM.resolveNode', { backendNodeId: 99 }, 'sess-1')
    expect(send).toHaveBeenCalledWith('DOM.getBoxModel', { objectId: 'obj-1' }, 'sess-1')

    const mouseCalls = send.mock.calls.filter((call) => call[0] === 'Input.dispatchMouseEvent')
    expect(mouseCalls).toHaveLength(2)
    expect(mouseCalls[0]?.[1]).toMatchObject({
      type: 'mousePressed',
      x: 30,
      y: 40,
      button: 'left',
      clickCount: 1,
    })
    expect(mouseCalls[1]?.[1]).toMatchObject({
      type: 'mouseReleased',
      x: 30,
      y: 40,
      button: 'left',
    })
  })

  it('takeScreenshot decodes base64 to Uint8Array', async () => {
    const { client, send } = createFakeClient()
    const pngBytes = new Uint8Array([1, 2, 3, 4])
    const base64 = btoa(String.fromCharCode(...pngBytes))
    send.mockResolvedValue({ data: base64 })

    const { takeScreenshot } = await import('@/services/browser/cdp-ops')
    const result = await takeScreenshot(client, 'sess-1')

    expect(send).toHaveBeenCalledWith(
      'Page.captureScreenshot',
      { format: 'png' },
      'sess-1',
    )
    expect(result.mimeType).toBe('image/png')
    expect(Array.from(result.data)).toEqual([1, 2, 3, 4])
  })

  it('getTabs maps targets to BrowserTab and updates registry', async () => {
    const { client, send } = createFakeClient()
    send.mockResolvedValue({
      targetInfos: [
        {
          targetId: 't-page',
          type: 'page',
          title: 'Example',
          url: 'https://example.com',
        },
        {
          targetId: 't-worker',
          type: 'service_worker',
          title: 'sw',
          url: 'https://example.com/sw.js',
        },
      ],
    })

    const { getTabs } = await import('@/services/browser/cdp-ops')
    const { listTabs } = await import('@/services/browser/registry')
    const tabs = await getTabs(client, 'ws-1')

    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({
      viewId: 't-page',
      workspaceId: 'ws-1',
      url: 'https://example.com',
      title: 'Example',
    })
    expect(listTabs('ws-1')).toEqual(tabs)
  })

  it('getTabs can use HTTP /json when cdpEndpoint is provided', async () => {
    const { client, send } = createFakeClient()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          {
            id: 'http-page',
            type: 'page',
            title: 'From JSON',
            url: 'https://from-json.test',
          },
        ],
      })),
    )

    const { getTabs } = await import('@/services/browser/cdp-ops')
    const tabs = await getTabs(client, 'ws-2', 'http://127.0.0.1:9222')

    expect(send).not.toHaveBeenCalled()
    expect(tabs[0]).toMatchObject({
      viewId: 'http-page',
      workspaceId: 'ws-2',
      url: 'https://from-json.test',
      title: 'From JSON',
    })
  })
})

describe('screenshot-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeTempBytes.mockResolvedValue({
      path: '/tmp/vixl/screenshots/shot.png',
      filename: 'shot.png',
    })
  })

  it('writes bytes and returns a ToolImagePart path', async () => {
    const saveScreenshot = (await import('@/services/browser/screenshot-store')).default
    const bytes = new Uint8Array([137, 80, 78, 71])
    const part = await saveScreenshot(bytes)

    expect(part).toEqual({
      mimeType: 'image/png',
      path: '/tmp/vixl/screenshots/shot.png',
    })
    expect(writeTempBytes).toHaveBeenCalledOnce()
    expect(writeTempBytes.mock.calls[0]?.[0]).toMatchObject({
      kind: 'screenshots',
      extension: 'png',
    })
    expect(typeof writeTempBytes.mock.calls[0]?.[0]?.contentBase64).toBe('string')
  })
})

describe('console-log-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    appendTempLog.mockImplementation(async (args) => ({
      path: args.path ?? `/tmp/vixl/${args.kind}/capture.log`,
      filename: 'capture.log',
    }))
  })

  it('appends formatted console lines from mocked events', async () => {
    const { client, emit } = createFakeClient()
    const { startConsoleLogCapture } = await import('@/services/browser/console-log-store')

    const capture = startConsoleLogCapture(client, 'sess-1', 'ws-1')

    await vi.waitFor(() => {
      expect(appendTempLog).toHaveBeenCalled()
    })

    emit(
      'Runtime.consoleAPICalled',
      {
        type: 'log',
        args: [{ type: 'string', value: 'hello world' }],
        timestamp: Date.parse('2026-01-01T00:00:00.000Z'),
      },
      'sess-1',
    )

    await vi.waitFor(() => {
      expect(
        appendTempLog.mock.calls.some((call) =>
          String(call[0]?.line ?? '').includes('console.log: hello world'),
        ),
      ).toBe(true)
    })

    expect(capture.logFile).toContain('browser-console-ws-1')
    capture.stop()
  })

  it('appends network response lines from mocked events', async () => {
    const { client, emit } = createFakeClient()
    const { startNetworkLogCapture } = await import('@/services/browser/console-log-store')

    const capture = startNetworkLogCapture(client, 'sess-1', 'ws-1')

    await vi.waitFor(() => {
      expect(appendTempLog).toHaveBeenCalled()
    })

    emit(
      'Network.responseReceived',
      {
        type: 'Document',
        response: {
          url: 'https://example.com',
          status: 200,
          mimeType: 'text/html',
        },
      },
      'sess-1',
    )

    await vi.waitFor(() => {
      expect(
        appendTempLog.mock.calls.some((call) =>
          String(call[0]?.line ?? '').includes('Document 200 text/html https://example.com'),
        ),
      ).toBe(true)
    })

    capture.stop()
  })
})
