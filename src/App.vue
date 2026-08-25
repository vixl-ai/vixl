<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import AppSidebar from '@/components/navigation/aside/left/LeftSidebar.vue'
import NavigationCommandPalette from '@/components/navigation/CommandPalette.vue'
import { SidebarInset, SidebarProvider } from '@/components/shadcn/ui/sidebar'
import RightSidebarProvider from '@/components/navigation/aside/right/RightSidebarProvider.vue'
import RightSidebar from '@/components/navigation/aside/right/RightSidebar.vue'
import WorkbenchWorkbenchShell from '@/components/workbench/WorkbenchShell.vue'
import WorkbenchWorkbenchTabDuplicateDialog from '@/components/workbench/WorkbenchTabDuplicateDialog.vue'
import WorkbenchHeader from '@/components/workbench/WorkbenchHeader.vue'
import TitleBar from '@/components/navigation/header/TitleBar.vue'
import WindowResizeHandles from '@/components/navigation/header/WindowResizeHandles.vue'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/shadcn/ui/resizable'
import { Toaster } from '@/components/shadcn/ui/sonner'
import useAppearance from '@/composables/use-appearance'
import useAppUpdater from '@/composables/use-app-updater'
import useCommandPalette from '@/composables/use-command-palette'
import useVixlLiveSync from '@/composables/use-vixl-live-sync'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { matchAppShortcut } from '@/utils/keyboard'
import { RouterView, useRouter } from 'vue-router'

type CollapsiblePanelApi = {
  collapse: () => void
  expand: () => void
  resize: (size: number) => void
}

const RIGHT_SIDEBAR_DEFAULT_SIZE = 35
const RIGHT_SIDEBAR_MIN_SIZE = 20

useFleetRegistry()
useAppearance()
useVixlLiveSync()
const updater = useAppUpdater()

const router = useRouter()
const { rightSidebarOpen, setRightSidebarOpen, toggleRightSidebar } = useWorkbenchStore()
const commandPalette = useCommandPalette()
const rightSidebarPanelRef = ref<CollapsiblePanelApi | null>(null)
let rightSidebarHasExpanded = rightSidebarOpen.value

const syncRightSidebarPanel = (open: boolean): void => {
  const panel = rightSidebarPanelRef.value
  if (!panel) {
    return
  }
  if (open) {
    panel.expand()
    // Cold start begins collapsed at size 0; expand falls back to minSize.
    // After the first expand we restore the pre-collapse width instead.
    if (!rightSidebarHasExpanded) {
      panel.resize(RIGHT_SIDEBAR_DEFAULT_SIZE)
      rightSidebarHasExpanded = true
    }
  } else {
    panel.collapse()
  }
}

const openNewAgent = async (): Promise<void> => {
  try {
    await router.push('/')
  } catch (error) {
    toast.error('Navigation failed', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleAppKeydown = (event: KeyboardEvent): void => {
  const action = matchAppShortcut(event)
  if (action === null) {
    return
  }

  event.preventDefault()

  if (action === 'toggle-right-sidebar') {
    event.stopImmediatePropagation()
    toggleRightSidebar()
    return
  }

  if (action === 'toggle-palette') {
    commandPalette.togglePalette()
    return
  }

  openNewAgent().catch((error: unknown) => {
    toast.error('Navigation failed', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  })
}

useEventListener('keydown', handleAppKeydown)

onMounted(async () => {
  await nextTick()
  syncRightSidebarPanel(rightSidebarOpen.value)
  await updater.checkForUpdates({ silent: true })
})

watch(rightSidebarOpen, (open) => {
  syncRightSidebarPanel(open)
})
</script>

<template>
  <SidebarProvider class="overflow-x-hidden">
    <AppSidebar />
    <SidebarInset class="min-w-0 w-0 flex-1 overflow-hidden bg-background">
      <RightSidebarProvider
        v-model:open="rightSidebarOpen"
        class="h-svh min-w-0 flex-1 overflow-hidden"
      >
        <TitleBar />
        <ResizablePanelGroup direction="horizontal" class="min-h-0 min-w-0 flex-1 overflow-hidden">
          <ResizablePanel :min-size="30" class="h-full min-h-0 min-w-0 overflow-hidden bg-background">
            <main
              class="flex h-full min-h-0 flex-col overflow-hidden bg-background pt-(--titlebar-height)"
              style="--titlebar-height: 40px"
            >
              <RouterView class="min-h-0 flex-1" />
            </main>
          </ResizablePanel>
          <ResizableHandle v-show="rightSidebarOpen" />
          <ResizablePanel
            ref="rightSidebarPanelRef"
            collapsible
            :collapsed-size="0"
            :default-size="rightSidebarOpen ? RIGHT_SIDEBAR_DEFAULT_SIZE : 0"
            :min-size="RIGHT_SIDEBAR_MIN_SIZE"
            :max-size="65"
            class="min-h-0 min-w-0 overflow-hidden"
            @collapse="setRightSidebarOpen(false)"
            @expand="setRightSidebarOpen(true)"
          >
            <RightSidebar class="relative pt-(--titlebar-height)" style="--titlebar-height: 40px">
              <WorkbenchHeader />
              <WorkbenchWorkbenchShell />
            </RightSidebar>
          </ResizablePanel>
        </ResizablePanelGroup>
      </RightSidebarProvider>
    </SidebarInset>
    <Toaster />
    <NavigationCommandPalette />
    <WorkbenchWorkbenchTabDuplicateDialog />
  </SidebarProvider>
  <WindowResizeHandles />
</template>
