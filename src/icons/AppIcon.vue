<script setup lang="ts">
import { computed } from 'vue'
import type { AppIconName } from './icon-names'
import { getIconPackAdapter, resolveIconComponent } from './resolve-icon'
import { useIconAppearance } from './icon-appearance'

/**
 * AppIcon — the only supported rendering path for app chrome/action icons.
 *
 * Resolves a semantic icon name through the active icon pack (Lucide, Tabler,
 * or Phosphor) and applies the theme's normalized icon appearance: size
 * scale, stroke weight, and optional tint. Extra attributes (class, handlers)
 * fall through to the underlying SVG like a direct icon component.
 *
 * Accessibility: icons are `aria-hidden` by default; pass `label` to expose a
 * `role="img"` accessible name. Color states (destructive/success/warning)
 * keep working because `currentColor` is preserved unless the theme sets an
 * explicit tint.
 *
 * Do not import icon packs directly in application code — add semantic names
 * to `src/icons/icon-names.ts` and the per-pack adapters instead. Specialized
 * artwork (file-type icons, provider logos, content-supplied images) stays
 * outside this system.
 */

const props = defineProps<{
  /** Semantic icon name resolved through the active icon pack. */
  name: AppIconName
  /** Explicit base size in px before the theme size scale (default 16). */
  size?: number | string
  /** Explicit normalized stroke-weight override (1–2.5). */
  strokeWidth?: number | string
  /** Accessible label; without one the icon is decorative (`aria-hidden`). */
  label?: string
}>()

const appearance = useIconAppearance()

const component = computed(() => resolveIconComponent(props.name, appearance.value.pack))

const adapter = computed(() => getIconPackAdapter(appearance.value.pack))

const resolvedSize = computed(() => {
  const base = props.size ?? 16
  if (typeof base === 'number' || /^\d+(\.\d+)?$/.test(String(base))) {
    const scaled = Number(base) * appearance.value.sizeScale
    return Math.round(scaled * 100) / 100
  }
  return base
})

const packProps = computed<Record<string, unknown>>(() => {
  const weight =
    props.strokeWidth === undefined
      ? appearance.value.weight
      : Number(props.strokeWidth) || appearance.value.weight
  return {
    ...adapter.value.strokeProps(weight),
    ...(appearance.value.tint === 'inherit' ? {} : { style: { color: appearance.value.tint } }),
    ...(props.label ? { role: 'img', 'aria-label': props.label } : { 'aria-hidden': true }),
  }
})
</script>

<template>
  <component
    :is="component"
    :width="resolvedSize"
    :height="resolvedSize"
    :data-icon="name"
    v-bind="packProps"
  />
</template>
