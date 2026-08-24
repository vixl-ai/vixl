<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { toast } from 'vue-sonner'
import {
  WINDOW_RESIZE_HANDLE_DIRECTIONS,
  shouldShowWindowResizeHandles,
  type WindowResizeHandleSide,
} from './window-resize-handles'

type UnlistenFn = () => void

const EDGE_PX = 6
const CORNER_PX = 12

const HANDLE_CLASSES: Record<WindowResizeHandleSide, string> = {
  n: 'left-0 right-0 top-0 cursor-ns-resize',
  s: 'left-0 right-0 bottom-0 cursor-ns-resize',
  e: 'top-0 right-0 bottom-0 cursor-ew-resize',
  w: 'top-0 bottom-0 left-0 cursor-ew-resize',
  ne: 'top-0 right-0 z-10 cursor-nesw-resize',
  nw: 'top-0 left-0 z-10 cursor-nwse-resize',
  se: 'right-0 bottom-0 z-10 cursor-nwse-resize',
  sw: 'bottom-0 left-0 z-10 cursor-nesw-resize',
}

const HANDLE_SIDES = Object.keys(HANDLE_CLASSES) as WindowResizeHandleSide[]

const appWindow = getCurrentWindow()
const isDecorated = ref(true)
const isMaximized = ref(false)
let unlistenResized: UnlistenFn | null = null

const showHandles = computed(() =>
  shouldShowWindowResizeHandles({
    isDecorated: isDecorated.value,
    isMaximized: isMaximized.value,
  }),
)

const handleStyle = (side: WindowResizeHandleSide): Record<string, string> => {
  if (side === 'n' || side === 's') {
    return { height: `${EDGE_PX}px` }
  }
  if (side === 'e' || side === 'w') {
    return { width: `${EDGE_PX}px` }
  }
  return { width: `${CORNER_PX}px`, height: `${CORNER_PX}px` }
}

const refreshMaximized = async (): Promise<void> => {
  try {
    isMaximized.value = await appWindow.isMaximized()
  } catch (error) {
    toast.error('Failed to read window maximize state', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handlePointerDown = (event: PointerEvent, side: WindowResizeHandleSide): void => {
  if (event.button !== 0) {
    return
  }
  event.preventDefault()
  appWindow.startResizeDragging(WINDOW_RESIZE_HANDLE_DIRECTIONS[side]).catch((error: unknown) => {
    toast.error('Failed to resize window', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  })
}

onMounted(async () => {
  try {
    isDecorated.value = await appWindow.isDecorated()
  } catch (error) {
    toast.error('Failed to read window decoration state', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
    return
  }
  if (isDecorated.value) {
    return
  }
  await refreshMaximized()
  try {
    unlistenResized = await appWindow.onResized(() => {
      void refreshMaximized()
    })
  } catch (error) {
    toast.error('Failed to listen for window resize', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
})

onUnmounted(() => {
  unlistenResized?.()
  unlistenResized = null
})
</script>

<template>
  <div
    v-if="showHandles"
    class="pointer-events-none fixed inset-0 z-[60]"
    data-tauri-drag-region="false"
  >
    <div
      v-for="side in HANDLE_SIDES"
      :key="side"
      class="pointer-events-auto absolute"
      :class="HANDLE_CLASSES[side]"
      :style="handleStyle(side)"
      data-tauri-drag-region="false"
      @pointerdown="handlePointerDown($event, side)"
    />
  </div>
</template>
