<script setup lang="ts">
import { AppIcon, type AppIconName } from '@/icons'
import { Button } from '@/components/shadcn/ui/button'
import { Label } from '@/components/shadcn/ui/label'
import type { VixlTheme } from '@/types/vixl/vixl-settings'

defineProps<{
  mode: VixlTheme
}>()

const emit = defineEmits<{
  select: [mode: VixlTheme]
}>()

const modeOptions = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
] as const satisfies readonly { value: VixlTheme; label: string; icon: AppIconName }[]
</script>

<template>
  <!-- Color mode (moved from General so there is a single control) -->
  <div class="space-y-2">
    <Label>Color mode</Label>
    <div class="flex items-center gap-1">
      <Button
        v-for="option in modeOptions"
        :key="option.value"
        variant="ghost"
        size="icon"
        class="h-7 w-7"
        :class="mode === option.value ? 'bg-muted text-foreground' : 'text-muted-foreground'"
        :aria-label="option.label"
        :aria-pressed="mode === option.value"
        @click="emit('select', option.value)"
      >
        <AppIcon :name="option.icon" class="h-4 w-4" />
      </Button>
      <span class="ml-2 text-xs text-muted-foreground"> Light, dark, or follow the system </span>
    </div>
  </div>
</template>
