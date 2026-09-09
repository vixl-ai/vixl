<script setup lang="ts">
import { AppIcon, provideIconAppearance } from '@/icons'
import { computed } from 'vue'
import { variantSwatchStyles } from './appearance-gallery-ui'
import type { VixlThemeVariant, VixlThemeVariantKind } from '@/types/appearance/theme'

/**
 * One variant's gallery thumbnail: a miniature app window built from the
 * variant's real tokens and canvas (same serializers as the runtime) with a
 * navigation/action icon sample rendered through the real AppIcon pack
 * runtime, so thumbnails match what the theme actually ships.
 *
 * Decorative by design: the whole swatch is aria-hidden and the card's select
 * control carries the accessible name.
 */
const props = defineProps<{
  variantTheme: VixlThemeVariant
  variantKind: VixlThemeVariantKind
}>()

// Scope this swatch's AppIcons to the variant's icon appearance so the icon
// sample reflects the theme's pack/weight/scale/tint.
provideIconAppearance(computed(() => props.variantTheme.icons))

const styles = computed(() => variantSwatchStyles(props.variantTheme))
</script>

<template>
  <div
    class="flex min-w-0 flex-1 flex-col rounded-md border border-black/10 p-1.5"
    :style="styles.canvas"
    :data-variant="variantKind"
    aria-hidden="true"
  >
    <div class="flex min-h-0 flex-1 gap-1.5">
      <div class="flex w-1/4 flex-col gap-1 rounded-sm p-1" :style="styles.sidebar">
        <span class="h-1 rounded-full" :style="styles.text" />
        <span class="h-1 w-2/3 rounded-full opacity-70" :style="styles.text" />
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <div class="min-h-0 flex-1 rounded-sm border" :style="styles.panel" />
        <div class="flex items-center gap-1">
          <span class="h-2.5 w-5 rounded-sm" :style="styles.accent" />
          <span class="h-1 min-w-0 flex-1 rounded-full" :style="styles.text" />
        </div>
        <div
          class="flex items-center gap-1"
          :style="{ color: variantTheme.colors.foreground }"
          data-testid="appearance-swatch-icons"
        >
          <AppIcon name="folder" size="10" />
          <AppIcon name="search" size="10" />
          <AppIcon name="settings" size="10" />
          <AppIcon name="plus" size="10" />
        </div>
      </div>
    </div>
  </div>
</template>
