<script setup lang="ts">
import { Moon, Sun } from '@lucide/vue'
import { Button } from '@landing/components/ui/button'
import { useLandingColorMode } from '@landing/composables/useLandingColorMode'

const { toggleTheme } = useLandingColorMode()
</script>

<template>
  <Button
    variant="ghost"
    size="icon"
    class="relative size-10 text-foreground hover:text-foreground/80 sm:size-9"
    @click="toggleTheme"
  >
    <Sun
      class="size-[1.1rem] rotate-0 scale-100 text-foreground transition-all dark:-rotate-90 dark:scale-0"
    />
    <Moon
      class="absolute size-[1.1rem] rotate-90 scale-0 text-foreground transition-all dark:rotate-0 dark:scale-100"
    />
    <span class="sr-only">Toggle theme</span>
  </Button>
</template>
