<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { Moon, Sun } from '@lucide/vue'
import { useColorMode } from '@vueuse/core'
import { toast } from 'vue-sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import useVixlConfig from '@/composables/use-vixl-config'
import type { VixlTheme } from '@/types/vixl/vixl-settings'

defineProps<{
  class?: HTMLAttributes['class']
}>()

const config = useVixlConfig()
const colorMode = useColorMode()

const toggleMode = async (): Promise<void> => {
  const theme: VixlTheme = colorMode.state.value === 'dark' ? 'light' : 'dark'

  try {
    await config.setTheme('personal', theme)
  } catch (error) {
    toast.error('Failed to save theme', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        data-slot="mode-toggle"
        variant="ghost"
        size="icon"
        :class="cn('h-7 w-7', $props.class)"
        aria-label="Toggle theme"
        @click="toggleMode"
      >
        <Moon
          class="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0"
        />
        <Sun
          class="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100"
        />
      </Button>
    </TooltipTrigger>
    <TooltipContent>Toggle theme</TooltipContent>
  </Tooltip>
</template>
