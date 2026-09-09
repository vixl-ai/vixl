<script setup lang="ts">
import { AppIcon } from '@/icons'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { toast } from 'vue-sonner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'

const appWindow = getCurrentWindow()

const handleClose = async (): Promise<void> => {
  try {
    await appWindow.close()
  } catch (error) {
    toast.error('Failed to close window', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleMinimize = async (): Promise<void> => {
  try {
    await appWindow.minimize()
  } catch (error) {
    toast.error('Failed to minimize window', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleToggleMaximize = async (): Promise<void> => {
  try {
    await appWindow.toggleMaximize()
  } catch (error) {
    toast.error('Failed to maximize window', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <!-- Custom macOS-style traffic lights (same on all platforms) -->
  <div class="group/controls flex items-center gap-2 pl-3 shrink-0" data-tauri-drag-region="false">
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          aria-label="Close"
          class="flex size-3 items-center justify-center rounded-full bg-[#ff5f57] transition-opacity hover:opacity-90"
          @click="handleClose"
        >
          <AppIcon
            name="x"
            class="size-2 text-black/60 opacity-0 group-hover/controls:opacity-100"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>Close</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          aria-label="Minimize"
          class="flex size-3 items-center justify-center rounded-full bg-[#febc2e] transition-opacity hover:opacity-90"
          @click="handleMinimize"
        >
          <AppIcon
            name="minus"
            class="size-2 text-black/60 opacity-0 group-hover/controls:opacity-100"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>Minimize</TooltipContent>
    </Tooltip>
    <Tooltip>
      <TooltipTrigger as-child>
        <button
          type="button"
          aria-label="Maximize"
          class="flex size-3 items-center justify-center rounded-full bg-[#28c840] transition-opacity hover:opacity-90"
          @click="handleToggleMaximize"
        >
          <AppIcon
            name="plus"
            class="size-2 text-black/60 opacity-0 group-hover/controls:opacity-100"
          />
        </button>
      </TooltipTrigger>
      <TooltipContent>Maximize</TooltipContent>
    </Tooltip>
  </div>
</template>
