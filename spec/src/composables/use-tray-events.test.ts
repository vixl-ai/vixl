import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import type { FleetProjectGroup } from '@/types/fleet/fleet-project-group'
import type { TrayOpenChatPayload } from '@/types/tray/tray-open-chat-payload'
import { setFleetGroupReader } from '@/utils/fleet-group-reader'
import { mockTauriEvent } from '../test-utils/mocks/tauri-event'
import { mockVixlTauri } from '../test-utils/mocks/vixl-tauri'

type TrayEventHandler = (event: { payload: unknown }) => void

const isTauri = vi.hoisted(() => vi.fn<() => boolean>(() => true))
const routerPush = vi.hoisted(() => vi.fn<(to: string) => Promise<void>>(async () => undefined))
const toastError = vi.hoisted(() => vi.fn<(...args: unknown[]) => void>())
const listen = vi.hoisted(() =>
  vi.fn<(event: string, handler: TrayEventHandler) => Promise<() => void>>(async () => () => {}),
)

vi.mock('@tauri-apps/api/event', () => mockTauriEvent({ listen }))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    isTauri: () => isTauri(),
  }),
)

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: (to: string) => routerPush(to),
  }),
}))

vi.mock('vue-sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: vi.fn<(...args: unknown[]) => void>(),
  },
}))

const handlers = new Map<string, TrayEventHandler>()
const unlistens = new Map<string, ReturnType<typeof vi.fn<() => void>>>()
let wrapper: VueWrapper | undefined

const flush = async (): Promise<void> => {
  await nextTick()
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const mountTray = async (): Promise<void> => {
  const { default: useTrayEvents } = await import('@/composables/use-tray-events')
  const Host = defineComponent({
    setup() {
      useTrayEvents()
      return {}
    },
    template: '<div />',
  })
  wrapper = mount(Host)
  if (isTauri()) {
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledTimes(2)
    })
    await flush()
    return
  }
  await flush()
}

const emitOpenChat = (payload: TrayOpenChatPayload): void => {
  handlers.get('vixl-tray-open-chat')?.({ payload })
}

const emitNewAgent = (): void => {
  handlers.get('vixl-tray-new-agent')?.({ payload: null })
}

describe('use-tray-events', () => {
  beforeEach(() => {
    handlers.clear()
    unlistens.clear()
    isTauri.mockReset()
    isTauri.mockReturnValue(true)
    routerPush.mockReset()
    routerPush.mockResolvedValue(undefined)
    listen.mockReset()
    listen.mockImplementation(async (event, handler) => {
      handlers.set(event, handler)
      const unlisten = vi.fn<() => void>()
      unlistens.set(event, unlisten)
      return unlisten
    })
    setFleetGroupReader(() => [])
    toastError.mockClear()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    setFleetGroupReader(() => [])
  })

  it('opens a home chat from the tray', async () => {
    await mountTray()
    emitOpenChat({ projectSlug: HOME_CHAT_SLUG, chatId: 'c1' })
    await flush()
    expect(routerPush).toHaveBeenCalledWith('/chat/c1')
  })

  it('opens a project chat from the tray', async () => {
    await mountTray()
    emitOpenChat({ projectSlug: 'api', chatId: 'c1' })
    await flush()
    expect(routerPush).toHaveBeenCalledWith('/project/api/chat/c1')
  })

  it('opens a group chat when the slug reader is seeded', async () => {
    setFleetGroupReader(
      () =>
        [
          {
            id: 'g1',
            name: 'api, web',
            slug: 'api-web',
            memberSlugs: ['api', 'web'],
            lastOpened: '',
          },
        ] satisfies FleetProjectGroup[],
    )
    await mountTray()
    emitOpenChat({ projectSlug: 'api-web', chatId: 'c1' })
    await flush()
    expect(routerPush).toHaveBeenCalledWith('/group/api-web/chat/c1')
  })

  it('opens a new chat from the tray', async () => {
    await mountTray()
    emitNewAgent()
    await flush()
    expect(routerPush).toHaveBeenCalledWith('/')
  })

  it('does not listen outside tauri', async () => {
    isTauri.mockReturnValue(false)
    await mountTray()
    expect(listen).not.toHaveBeenCalled()
    expect(routerPush).not.toHaveBeenCalled()
  })

  it('unlistens tray events on unmount', async () => {
    await mountTray()
    expect(listen).toHaveBeenCalledWith('vixl-tray-open-chat', expect.any(Function))
    expect(listen).toHaveBeenCalledWith('vixl-tray-new-agent', expect.any(Function))
    wrapper?.unmount()
    wrapper = undefined
    await flush()
    expect(unlistens.get('vixl-tray-open-chat')).toHaveBeenCalledTimes(1)
    expect(unlistens.get('vixl-tray-new-agent')).toHaveBeenCalledTimes(1)
  })

  it('toasts when tray navigation fails', async () => {
    routerPush.mockRejectedValueOnce(new Error('nope'))
    await mountTray()
    emitOpenChat({ projectSlug: 'api', chatId: 'c1' })
    await vi.waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Navigation failed', {
        description: 'nope',
      })
    })
  })
})
