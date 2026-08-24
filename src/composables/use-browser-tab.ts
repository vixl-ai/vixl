import {
  computed,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue'
import { toast } from 'vue-sonner'
import createBrowserTabSession from '@/composables/create-browser-tab-session'
import useBrowserBookmarks from '@/composables/use-browser-bookmarks'
import useBrowserConsole from '@/composables/use-browser-console'
import useBrowserElementSelect from '@/composables/use-browser-element-select'
import useBrowserHostResize from '@/composables/use-browser-host-resize'
import useBrowserLockOverlay from '@/composables/use-browser-lock-overlay'
import useBrowserNavigation from '@/composables/use-browser-navigation'
import useBrowserPassthroughSuspend from '@/composables/use-browser-passthrough-suspend'
import useBrowserToolbar from '@/composables/use-browser-toolbar'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { browserCefLastWarmInitError } from '@/services/vixl/vixl-tauri/browser'
import formatUnknownError from '@/utils/format-unknown-error'

export default (workspaceId: string, tabId: string) => {
  const workbench = useWorkbenchStore()
  const passthroughSuspend = useBrowserPassthroughSuspend()

  const starting = ref(true)
  const addressBarValue = ref('')
  const canBack = ref(false)
  const canForward = ref(false)
  const addressInputRef = ref<HTMLInputElement | null>(null)
  const hostEl = ref<HTMLElement | null>(null)
  const cefReady = ref(false)
  const hasPage = ref(false)
  const pageTitle = ref('')
  const pageUrl = ref('')

  const isTabActive = computed(
    () => workbench.activeTabId.value === tabId,
  )

  const currentUrl = computed(() => {
    if (pageUrl.value && pageUrl.value !== 'about:blank') {
      return pageUrl.value
    }
    return addressBarValue.value.trim()
  })

  const currentTabTitle = computed(() => pageTitle.value || null)

  const session = createBrowserTabSession({
    workspaceId,
    addressBarValue,
    canBack,
    canForward,
    pageTitle,
    pageUrl,
    cefReady,
    hasPage,
    isTabActive,
    addressInputRef,
    hostEl,
  })

  const lockOverlay = useBrowserLockOverlay({
    getCefSessionId: session.getCefSessionId,
    cefSessionId: session.cefSessionId,
  })

  const bookmarksApi = useBrowserBookmarks(workspaceId, currentUrl)
  const consoleApi = useBrowserConsole()

  const elementSelect = useBrowserElementSelect({
    workspaceId,
    getCefSessionId: session.getCefSessionId,
    getClient: session.getCdpClient,
    hasPage,
  })

  const toolbar = useBrowserToolbar({
    currentUrl,
    getCefSessionId: session.getCefSessionId,
    getClient: session.getCdpClient,
  })

  const navigation = useBrowserNavigation({
    cefReady,
    pageUrl,
    addressBarValue,
    addressInputRef,
    ensureCefSession: session.ensureCefSession,
    getCefSessionId: session.getCefSessionId,
    markNavigated: session.markNavigated,
    showCefView: session.showCefView,
    refreshState: session.refreshState,
    startPolling: session.startPolling,
    recordHistoryUrl: toolbar.recordHistoryUrl,
  })

  const pages = useBrowserPages({
    workspaceId,
    getActiveSessionId: session.getCefSessionId,
    switchToSession: session.switchToSession,
    detachActiveSession: session.detachActiveSession,
  })

  const bootstrap = async (): Promise<void> => {
    starting.value = true
    try {
      const lastWarmInitError = await browserCefLastWarmInitError()
      if (lastWarmInitError) {
        toast.error('Failed to start browser', {
          description: lastWarmInitError,
        })
      }
      await session.ensureCefSession()
      starting.value = false
      if (isTabActive.value) {
        if (hasPage.value) {
          await session.showCefView()
        } else {
          await session.hideCefView()
        }
        session.startPolling()
      }
      consoleApi.attachConsole(session.getCdpClient).catch(() => {
        consoleApi.detachConsole()
      })
      if (hasPage.value) {
        toolbar.recordHistoryUrl(pageUrl.value)
      } else {
        await session.focusAddressBar(addressInputRef)
      }
    } catch (error) {
      toast.error('Failed to start browser', {
        description: formatUnknownError(error),
      })
    } finally {
      starting.value = false
    }
  }

  const cleanup = (): void => {
    session.stopPolling()
    elementSelect.stopElementSelect()
    consoleApi.detachConsole()
    session.destroyAllSessions().catch((error: unknown) => {
      toast.error('Failed to close browser view', {
        description: formatUnknownError(error),
      })
    })
  }

  watch(isTabActive, (active) => {
    if (!session.isCreated()) {
      return
    }
    if (active) {
      const reveal = hasPage.value
        ? session.showCefView()
        : session.hideCefView()
      reveal
        .then(() => session.syncPassthroughRects())
        .catch((error: unknown) => {
          toast.error(
            hasPage.value
              ? 'Failed to show browser view'
              : 'Failed to hide browser view',
            {
              description: formatUnknownError(error),
            },
          )
        })
      session.startPolling()
      return
    }
    session.stopPolling()
    elementSelect.stopElementSelect()
    session.hideCefView().catch((error: unknown) => {
      toast.error('Failed to hide browser view', {
        description: formatUnknownError(error),
      })
    })
  })

  watch(
    [hasPage, () => passthroughSuspend.suspended.value],
    () => {
      if (!session.isCreated()) {
        return
      }
      session.syncPassthroughRects().catch((error: unknown) => {
        toast.error('Failed to update browser click targets', {
          description: formatUnknownError(error),
        })
      })
    },
  )

  const { layoutBusy } = useBrowserHostResize({
    hostEl,
    hasPage,
    isTabActive,
    getCefSessionId: session.getCefSessionId,
    hideCefView: session.hideCefView,
    resizeToHost: session.resizeToHost,
  })

  onBeforeUnmount(() => {
    cleanup()
  })

  const handleAddressBlur = (): void => {
    session.resyncAddressBar()
  }

  return {
    starting,
    addressBarValue,
    canBack,
    canForward,
    addressInputRef,
    hostEl,
    cefReady,
    hasPage,
    layoutBusy,
    activeLock: lockOverlay.activeLock,
    lockOwnerTitle: lockOverlay.ownerTitle,
    lockOwnerSubagentLabel: lockOverlay.ownerSubagentLabel,
    lockWaiterCount: lockOverlay.waiterCount,
    currentUrl,
    currentTabTitle,
    elementSelectMode: elementSelect.elementSelectMode,
    elementSelectDisabled: false,
    toggleElementSelect: elementSelect.toggleElementSelect,
    handleTakeControl: lockOverlay.handleTakeControl,
    handleOpenOwnerChat: lockOverlay.handleOpenOwnerChat,
    handleNavigate: navigation.handleNavigate,
    handleBack: navigation.handleBack,
    handleForward: navigation.handleForward,
    handleReload: navigation.handleReload,
    handleAddressBlur,
    bootstrap,
    cleanup,
    pages: pages.pages,
    activePageSessionId: pages.activeSessionId,
    selectPage: pages.selectPage,
    closePage: pages.closePage,
    addPage: pages.addPage,
    ...bookmarksApi,
    consoleOpen: consoleApi.consoleOpen,
    lines: consoleApi.lines,
    clearConsole: consoleApi.clearConsole,
    toggleConsole: consoleApi.toggleConsole,
    ...toolbar,
  }
}
