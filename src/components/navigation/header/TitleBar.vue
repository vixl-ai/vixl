<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { SidebarTrigger, useSidebar } from '@/components/shadcn/ui/sidebar'
import WindowControls from './WindowControls.vue'
import RightSidebarTrigger from '@/components/navigation/aside/right/RightSidebarTrigger.vue'
import ModeToggle from './ModeToggle.vue'
import ChatChatBreadcrumbs from '@/components/chat/ChatBreadcrumbs.vue'
import useWorkbenchStore from '@/composables/use-workbench-store'

const workbench = useWorkbenchStore()
const { open: leftSidebarOpen, isMobile } = useSidebar()
const rightSidebarWidthPx = ref(0)

const leftChromeWidth = computed(() => {
  if (isMobile.value || !leftSidebarOpen.value) {
    return undefined
  }
  return 'var(--sidebar-width)'
})

const rightSidebarElement = (): HTMLElement | null => {
  const el = document.querySelector('[data-slot="right-sidebar"]')
  return el instanceof HTMLElement ? el : null
}

const syncRightSidebarWidth = (): void => {
  if (!workbench.rightSidebarOpen.value) {
    rightSidebarWidthPx.value = 0
    return
  }
  const el = rightSidebarElement()
  rightSidebarWidthPx.value = el?.getBoundingClientRect().width ?? 0
}

let rightSidebarObserver: ResizeObserver | null = null

const observeRightSidebar = (): void => {
  rightSidebarObserver?.disconnect()
  const el = rightSidebarElement()
  if (!el) {
    return
  }
  rightSidebarObserver = new ResizeObserver(() => {
    syncRightSidebarWidth()
  })
  rightSidebarObserver.observe(el)
}

onMounted(() => {
  syncRightSidebarWidth()
  observeRightSidebar()
})

onUnmounted(() => {
  rightSidebarObserver?.disconnect()
  rightSidebarObserver = null
})

watch(
  () => workbench.rightSidebarOpen.value,
  async () => {
    await nextTick()
    syncRightSidebarWidth()
    observeRightSidebar()
  },
)
</script>

<template>
  <header
    class="pointer-events-none fixed inset-x-0 top-0 z-50 flex h-(--titlebar-height) shrink-0 items-center bg-none"
    style="--titlebar-height: 40px"
  >
    <!--
      Left chrome stays a dedicated non-overlapping slot for traffic lights +
      toggles. Extra space inside the open sidebar is still draggable.
    -->
    <div
      class="pointer-events-auto flex h-full shrink-0 items-center"
      :style="leftChromeWidth ? { width: leftChromeWidth } : undefined"
    >
      <div
        class="flex h-full shrink-0 items-center"
        data-tauri-drag-region="false"
      >
        <WindowControls />
        <SidebarTrigger class="ml-2" />
        <ModeToggle class="ml-1" />
      </div>
      <div
        class="h-full min-w-0 flex-1"
        data-tauri-drag-region
      />
    </div>

    <div
      class="pointer-events-auto ml-3 min-w-0 overflow-hidden"
      data-tauri-drag-region="false"
    >
      <ChatChatBreadcrumbs class="min-w-0" />
    </div>

    <!-- Primary window drag surface across empty titlebar space -->
    <div
      class="pointer-events-auto h-full min-w-0 flex-1"
      data-tauri-drag-region
    />

    <!-- Leave room for the chat-column context ring when the workbench owns the right edge. -->
    <div
      class="h-full shrink-0"
      :style="{ width: 'var(--titlebar-safe-right)' }"
      data-tauri-drag-region
    />

    <div
      v-if="!workbench.rightSidebarOpen.value"
      class="pointer-events-auto relative z-[52] mr-3"
      data-tauri-drag-region="false"
    >
      <RightSidebarTrigger />
    </div>
    <div
      v-else
      class="pointer-events-none h-full shrink-0"
      :style="{ width: `${rightSidebarWidthPx}px` }"
    />
  </header>
</template>
