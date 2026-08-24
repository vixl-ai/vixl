import { beforeEach, describe, expect, it, vi } from 'vitest'
import { asSchema } from 'ai'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { PendingApprovalView } from '@/services/harness/permission/gate'

const gateToolPermission = vi.fn<() => Promise<boolean>>().mockResolvedValue(true)

const acquireLock = vi.fn<(...args: unknown[]) => unknown>()
const assertLockedBy = vi.fn<(...args: unknown[]) => unknown>()
const releaseLock = vi.fn<(...args: unknown[]) => void>()
const getLastInteractedViewId = vi.fn<() => string | null>(() => 'cef-1')
const setLastInteractedViewId = vi.fn<(...args: unknown[]) => void>()
const listTabs = vi.fn<() => unknown[]>(() => [
  {
    viewId: 'cef-1',
    workspaceId: 'project',
    url: 'https://example.com',
    title: 'Example',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
])
const upsertTab = vi.fn<(...args: unknown[]) => void>()
const removeTab = vi.fn<(...args: unknown[]) => void>()
const resolveSessionIdForWorkspace = vi.fn<
  (workspaceId: string, sessionId?: string) => string | null
>(() => 'cef-1')
const getSessionCdpClient = vi.fn<() => Promise<unknown>>()
const registerCefSession = vi.fn<(...args: unknown[]) => void>()
const unregisterCefSession = vi.fn<(...args: unknown[]) => void>()

const mockClient = {
  send: vi.fn<() => Promise<unknown>>().mockResolvedValue({}),
}

const navigate = vi.fn<() => Promise<unknown>>()
const getAccessibilitySnapshot = vi.fn<() => Promise<unknown>>()
const takeScreenshot = vi.fn<() => Promise<unknown>>()
const click = vi.fn<() => Promise<void>>()
const clickAtPoint = vi.fn<() => Promise<void>>()
const type = vi.fn<() => Promise<void>>()
const fill = vi.fn<() => Promise<void>>()
const selectOption = vi.fn<() => Promise<void>>()
const pressKey = vi.fn<() => Promise<void>>()
const scroll = vi.fn<() => Promise<void>>()
const drag = vi.fn<() => Promise<void>>()
const getBoundingBox = vi.fn<() => Promise<unknown>>()
const highlight = vi.fn<() => Promise<void>>()
const applyUserAgentOverride = vi.fn<() => Promise<void>>()

const saveScreenshot = vi.fn<() => Promise<unknown>>()

vi.mock('@/composables/use-fleet-sidebar', () => ({
  chatTitleForId: vi.fn<(chatId: string) => string | null>(() => null),
  default: vi.fn<() => Record<string, never>>(),
  refreshFleetSidebar: vi.fn<() => Promise<void>>(),
}))

vi.mock('@/services/harness/permission/gate', () => ({
  gateToolPermission,
}))

vi.mock('@/services/browser/registry', () => ({
  acquireLock,
  assertLockedBy,
  releaseLock,
  getLastInteractedViewId,
  setLastInteractedViewId,
  listTabs,
  upsertTab,
  removeTab,
  resolveSessionIdForWorkspace,
  getSessionCdpClient,
  registerCefSession,
  unregisterCefSession,
  takeControl: vi.fn<() => void>(),
  releaseLocksForChat: vi.fn<() => void>(),
  getSessionWaiters: vi.fn<() => unknown[]>(() => []),
  browserRegistryRevision: { value: 0 },
  resetBrowserRegistryForTests: vi.fn<() => void>(),
}))

vi.mock('@/services/browser/cdp-ops', () => ({
  createTab: vi.fn<() => Promise<unknown>>(),
  closeTab: vi.fn<() => Promise<unknown>>(),
  selectTab: vi.fn<() => Promise<unknown>>(),
  getTabs: vi.fn<() => Promise<unknown>>(),
  navigate,
  getAccessibilitySnapshot,
  takeScreenshot,
  click,
  clickAtPoint,
  type,
  fill,
  selectOption,
  pressKey,
  scroll,
  drag,
  getBoundingBox,
  highlight,
  applyUserAgentOverride,
  resolveRef: vi.fn<() => Promise<unknown>>(),
  resetCdpOpsForTests: vi.fn<() => void>(),
}))

vi.mock('@/services/browser/cdp-user-agent', () => ({
  applyUserAgentOverride,
}))

vi.mock('@/services/browser/screenshot-store', () => ({
  default: saveScreenshot,
}))

const createCefSession = vi.fn<() => Promise<string>>(async () => 'cef-new')
const destroyCefSession = vi.fn<() => Promise<void>>(async () => undefined)
const ensureWorkbenchBrowser = vi.fn<() => Promise<{ ok: true }>>(async () => ({
  ok: true,
}))

vi.mock('@/services/browser/create-cef-session', () => ({
  default: createCefSession,
}))

vi.mock('@/services/browser/destroy-cef-session', () => ({
  default: destroyCefSession,
}))

vi.mock('@/services/harness/browser/ensure-workbench-browser', () => ({
  default: ensureWorkbenchBrowser,
}))

const BROWSER_TOOL_NAMES = [
  'browser_tabs',
  'browser_navigate',
  'browser_lock',
  'browser_snapshot',
  'browser_take_screenshot',
  'browser_click',
  'browser_mouse_click_xy',
  'browser_type',
  'browser_fill',
  'browser_select_option',
  'browser_press_key',
  'browser_scroll',
  'browser_drag',
  'browser_get_bounding_box',
  'browser_highlight',
  'browser_cdp',
] as const

describe('harness browser tools', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateToolPermission.mockResolvedValue(true)
    assertLockedBy.mockReturnValue({ ok: true })
    acquireLock.mockResolvedValue({ ok: true })
    releaseLock.mockReturnValue(undefined)
    getLastInteractedViewId.mockReturnValue('cef-1')
    resolveSessionIdForWorkspace.mockImplementation(
      (_workspaceId: string, sessionId?: string) => sessionId?.trim() || 'cef-1',
    )
    listTabs.mockReturnValue([
      {
        viewId: 'cef-1',
        workspaceId: 'project',
        url: 'https://example.com',
        title: 'Example',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ])
    getSessionCdpClient.mockResolvedValue(mockClient)
    navigate.mockResolvedValue({ frameId: 'frame-1', loaderId: 'loader-1' })
    getAccessibilitySnapshot.mockResolvedValue({
      snapshotId: 'snap-1',
      nodes: [{ ref: 'e1', role: 'button', name: 'Go', children: [] }],
    })
    takeScreenshot.mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
    })
    saveScreenshot.mockResolvedValue({
      mimeType: 'image/png',
      path: '/tmp/shot.png',
    })
    click.mockResolvedValue(undefined)
    clickAtPoint.mockResolvedValue(undefined)
    type.mockResolvedValue(undefined)
    fill.mockResolvedValue(undefined)
    selectOption.mockResolvedValue(undefined)
    pressKey.mockResolvedValue(undefined)
    scroll.mockResolvedValue(undefined)
    drag.mockResolvedValue(undefined)
    getBoundingBox.mockResolvedValue({ x: 1, y: 2, width: 3, height: 4 })
    highlight.mockResolvedValue(undefined)
    applyUserAgentOverride.mockResolvedValue(undefined)
    mockClient.send.mockResolvedValue({ result: true })
  })

  const ctx = {
    projectRoot: '/project',
    projectSlug: 'project',
    chatId: 'chat-1',
    userMessageId: 'user-1',
    settings: { version: 1 } as VixlSettings,
    permissionLevel: 'ask' as const,
    sessionAllows: new Set<string>(),
    sessionDenies: new Set<string>(),
    sandboxEnabled: true,
    supportsVision: true,
    onPendingApproval: vi.fn<(entry: PendingApprovalView) => void>(),
  }

  const runTool = async (
    execute: unknown,
    input: Record<string, unknown>,
    toolCallId = 'tc-browser',
  ): Promise<unknown> => {
    const runner = execute as (
      value: Record<string, unknown>,
      options: { toolCallId: string },
    ) => Promise<unknown>
    return runner(input, { toolCallId })
  }

  it('constructs each browser tool on the harness tool map', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    for (const name of BROWSER_TOOL_NAMES) {
      const tool = tools[name]
      expect(tool).toBeDefined()
      expect(typeof tool.execute).toBe('function')
    }
  })

  it('returns rejected when gateToolPermission denies', async () => {
    gateToolPermission.mockResolvedValue(false)
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_click.execute, { ref: 'e1' })
    expect(result).toEqual({ rejected: true, error: 'Browser access denied' })
    expect(assertLockedBy).not.toHaveBeenCalled()
    expect(getSessionCdpClient).not.toHaveBeenCalled()
  })

  it('returns browser_locked when assertLockedBy fails', async () => {
    assertLockedBy.mockReturnValue({
      ok: false,
      error: 'browser_locked',
      ownerChatId: 'chat-other',
    })
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_click.execute, { ref: 'e1' })
    expect(result).toEqual({
      error: 'browser_locked',
      ownerChatId: 'chat-other',
    })
    expect(getSessionCdpClient).not.toHaveBeenCalled()
  })

  it('browser_navigate auto-acquires lock when none held', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_navigate.execute, {
      url: 'https://example.com',
    })

    expect(acquireLock).toHaveBeenCalledWith({
      sessionId: 'cef-1',
      workspaceId: 'project',
      chatId: 'chat-1',
      subagentId: undefined,
      wait: false,
    })
    expect(navigate).toHaveBeenCalledWith(mockClient, '', 'https://example.com')
    expect(result).toMatchObject({
      viewId: 'cef-1',
      session_id: 'cef-1',
      url: 'https://example.com',
    })
  })

  it('browser_navigate returns browser_locked when another chat holds the lock', async () => {
    acquireLock.mockResolvedValue({
      ok: false,
      error: 'browser_locked',
      ownerChatId: 'chat-other',
      ownerTitle: null,
      queueLength: 0,
    })
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_navigate.execute, {
      url: 'https://example.com',
    })

    expect(result).toEqual({
      error: 'browser_locked',
      ownerChatId: 'chat-other',
      ownerTitle: null,
      queueLength: 0,
    })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('browser_take_screenshot returns imageParts', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_take_screenshot.execute, {
      fullPage: true,
    })

    expect(takeScreenshot).toHaveBeenCalledWith(mockClient, '', {
      fullPage: true,
      ref: undefined,
      type: undefined,
    })
    expect(saveScreenshot).toHaveBeenCalled()
    expect(result).toMatchObject({
      viewId: 'cef-1',
      mimeType: 'image/png',
      imageParts: [{ mimeType: 'image/png', path: '/tmp/shot.png' }],
    })
  })

  it('browser_lock acquires and releases without CDP', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const locked = await runTool(tools.browser_lock.execute, { action: 'lock' })
    expect(acquireLock).toHaveBeenCalledWith({
      sessionId: 'cef-1',
      workspaceId: 'project',
      chatId: 'chat-1',
      subagentId: undefined,
      wait: false,
      signal: undefined,
    })
    expect(getSessionCdpClient).not.toHaveBeenCalled()
    expect(locked).toEqual({
      locked: true,
      workspaceId: 'project',
      session_id: 'cef-1',
      viewId: 'cef-1',
    })

    const unlocked = await runTool(tools.browser_lock.execute, { action: 'unlock' })
    expect(releaseLock).toHaveBeenCalledWith({
      sessionId: 'cef-1',
      chatId: 'chat-1',
    })
    expect(unlocked).toEqual({
      locked: false,
      workspaceId: 'project',
      session_id: 'cef-1',
      viewId: 'cef-1',
    })
  })

  it('browser_lock wait true parks via acquireLock', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    await runTool(tools.browser_lock.execute, { action: 'lock', wait: true })
    expect(acquireLock).toHaveBeenCalledWith({
      sessionId: 'cef-1',
      workspaceId: 'project',
      chatId: 'chat-1',
      subagentId: undefined,
      wait: true,
      signal: undefined,
    })
  })

  it('browser_lock wait false returns cancelled payload when takeControl wins', async () => {
    acquireLock.mockResolvedValue({
      ok: false,
      error: 'browser_lock_cancelled',
      cancelled: 'user_took_control',
    })
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_lock.execute, {
      action: 'lock',
      wait: true,
    })
    expect(result).toEqual({
      error: 'browser_lock_cancelled',
      cancelled: 'user_took_control',
    })
  })

  it('browser_cdp description requires Runtime.evaluate expression as a JS string', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const description = String(tools.browser_cdp.description ?? '')

    expect(description).toContain('params.expression must be a JavaScript string')
    expect(description).toContain('"expression": "document.title"')
    expect(description).toContain('{ "expression": { "expression": "document.title" } }')
    expect(description).toContain('Nested { expression: "..." } is invalid')
  })

  it('browser_cdp JSON schema types params.expression as string', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)
    const jsonSchema = await asSchema(tools.browser_cdp.inputSchema).jsonSchema
    const paramsSchema = (
      jsonSchema.properties as Record<string, { properties?: Record<string, { type?: string }> }> | undefined
    )?.params
    expect(paramsSchema?.properties?.expression?.type).toBe('string')
  })

  it('browser_cdp rejects nested expression object without sending CDP', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_cdp.execute, {
      method: 'Runtime.evaluate',
      params: { expression: { expression: 'document.title' } },
    })

    expect(mockClient.send).not.toHaveBeenCalled()
    expect(result).toEqual({
      error: 'invalid_cdp_params',
      path: 'params.expression',
      expected: 'string (JavaScript source)',
      received: 'object',
      example: {
        method: 'Runtime.evaluate',
        params: { expression: 'document.title', returnByValue: true },
      },
    })
  })

  it('browser_cdp sends Runtime.evaluate when expression is a string', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_cdp.execute, {
      method: 'Runtime.evaluate',
      params: { expression: 'document.title', returnByValue: true },
    })

    expect(mockClient.send).toHaveBeenCalledTimes(1)
    expect(mockClient.send).toHaveBeenCalledWith(
      'Runtime.evaluate',
      { expression: 'document.title', returnByValue: true },
      '',
    )
    expect(result).toMatchObject({
      method: 'Runtime.evaluate',
      viewId: 'cef-1',
      result: { result: true },
    })
  })

  it('browser_cdp rejects nested functionDeclaration without sending CDP', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_cdp.execute, {
      method: 'Runtime.callFunctionOn',
      params: {
        functionDeclaration: { functionDeclaration: 'function() { return 1 }' },
      },
    })

    expect(mockClient.send).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      error: 'invalid_cdp_params',
      path: 'params.functionDeclaration',
      expected: 'string (JavaScript source)',
      received: 'object',
    })
  })

  it('browser_cdp returns method, CDP code, and hint when send fails', async () => {
    mockClient.send.mockRejectedValueOnce(
      new Error('CDP error -32602: Invalid parameters'),
    )
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_cdp.execute, {
      method: 'Runtime.evaluate',
      params: { expression: 'document.title' },
    })

    expect(mockClient.send).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      error: 'cdp_failed',
      method: 'Runtime.evaluate',
      code: -32602,
      message: 'Invalid parameters',
      hint: 'params.expression must be a JavaScript string, not a nested object',
    })
  })

  it('browser_cdp denies Input methods', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_cdp.execute, {
      method: 'Input.dispatchMouseEvent',
      params: {},
    })

    expect(result).toMatchObject({
      error: 'cdp_method_denied',
      method: 'Input.dispatchMouseEvent',
    })
    expect(mockClient.send).not.toHaveBeenCalled()
  })

  it('browser_snapshot returns yaml and snapshotId', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_snapshot.execute, {})
    expect(result).toMatchObject({
      snapshotId: 'snap-1',
      viewId: 'cef-1',
    })
    expect(result).toHaveProperty('yaml')
    expect(String((result as { yaml: string }).yaml)).toContain('[ref=e1]')
  })

  it('browser_mouse_click_xy clicks at viewport coordinates', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_mouse_click_xy.execute, {
      x: 12,
      y: 34,
      button: 'left',
    })

    expect(clickAtPoint).toHaveBeenCalledWith(mockClient, '', 12, 34, {
      button: 'left',
    })
    expect(result).toMatchObject({ ok: true, x: 12, y: 34, viewId: 'cef-1' })
  })

  it('browser_tabs new creates a CEF session', async () => {
    const buildTools = (await import('@/services/harness/build-tools')).default
    const tools = buildTools(ctx)

    const result = await runTool(tools.browser_tabs.execute, { action: 'new' })
    expect(createCefSession).toHaveBeenCalledWith('project')
    expect(result).toMatchObject({ session_id: 'cef-new', viewId: 'cef-new' })
  })
})
