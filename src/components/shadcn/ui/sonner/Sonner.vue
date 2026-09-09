<script lang="ts" setup>
import { AppIcon } from '@/icons'
import type { ToasterProps } from 'vue-sonner'
import { reactiveOmit, useColorMode } from '@vueuse/core'
import { computed } from 'vue'
import { Toaster as Sonner } from 'vue-sonner'
import { cn } from '@/lib/utils'

const props = defineProps<ToasterProps>()
const delegatedProps = reactiveOmit(props, 'toastOptions', 'theme')

const mode = useColorMode()
const sonnerTheme = computed(() => (mode.value === 'auto' ? 'system' : mode.value))
</script>

<template>
  <Sonner
    :theme="sonnerTheme"
    class="toaster group pointer-events-auto"
    :toast-options="{
      classes: {
        toast:
          'group toast glass-surface-overlay group-[.toaster]:border-border group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:shadow-lg',
        description: 'group-[.toast]:text-muted-foreground',
        actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
        cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
      },
    }"
    v-bind="delegatedProps"
    :class="cn(props.class)"
  >
    <template #success-icon>
      <AppIcon name="circle-check" class="size-4" />
    </template>
    <template #info-icon>
      <AppIcon name="info" class="size-4" />
    </template>
    <template #warning-icon>
      <AppIcon name="triangle-alert" class="size-4" />
    </template>
    <template #error-icon>
      <AppIcon name="octagon-x" class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <AppIcon name="loader" class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <AppIcon name="x" class="size-4" />
    </template>
  </Sonner>
</template>
