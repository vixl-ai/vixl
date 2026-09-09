<script setup lang="ts">
import { ref } from 'vue'
import AppearanceThemeCard from './AppearanceThemeCard.vue'
import type { GalleryTheme } from './appearance-gallery-ui'

/**
 * Grouped visual theme gallery: an accessible "Built-in themes" section
 * (immutable bundled themes) and a "My themes" section (personal library),
 * rendered as a responsive card grid with dual light/dark swatch thumbnails.
 *
 * Keyboard semantics: each card's main select control is a real button
 * (Enter/Space applies the theme); Arrow keys / Home / End move focus between
 * card controls in DOM order with wrap-around, so the gallery stays fully
 * operable without a pointer.
 */
defineProps<{
  builtIn: GalleryTheme[]
  custom: GalleryTheme[]
  activeId: string
  previewingId: string | null
  /** True while the draft editor is open; card previews pause then. */
  editing: boolean
}>()

const emit = defineEmits<{
  use: [id: string]
  preview: [id: string]
  customize: [id: string]
  edit: [id: string]
  delete: [id: string]
}>()

const root = ref<HTMLElement | null>(null)

const NAVIGATION_KEYS = new Set([
  'ArrowRight',
  'ArrowLeft',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
])

const cardButtons = (): HTMLElement[] =>
  Array.from(root.value?.querySelectorAll<HTMLElement>('[data-theme-card-button]') ?? [])

const onKeydown = (event: KeyboardEvent): void => {
  if (!NAVIGATION_KEYS.has(event.key)) {
    return
  }
  const buttons = cardButtons()
  const currentIndex = buttons.findIndex((button) => button === document.activeElement)
  if (buttons.length === 0 || currentIndex === -1) {
    return
  }
  event.preventDefault()
  let next = currentIndex
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    next = currentIndex + 1
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    next = currentIndex - 1
  } else if (event.key === 'Home') {
    next = 0
  } else {
    next = buttons.length - 1
  }
  next = (next + buttons.length) % buttons.length
  buttons[next]?.focus()
}
</script>

<template>
  <div
    ref="root"
    class="space-y-6"
    role="group"
    aria-label="Theme gallery"
    data-testid="appearance-theme-gallery"
    @keydown="onKeydown"
  >
    <section class="space-y-2">
      <h3 class="text-sm font-medium">Built-in themes</h3>
      <ul
        class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="appearance-gallery-builtin"
      >
        <AppearanceThemeCard
          v-for="entry in builtIn"
          :key="entry.theme.id"
          :entry="entry"
          :active="entry.theme.id === activeId"
          :previewing="entry.theme.id === previewingId"
          :editing="editing"
          @use="emit('use', entry.theme.id)"
          @preview="emit('preview', entry.theme.id)"
          @customize="emit('customize', entry.theme.id)"
        />
      </ul>
    </section>

    <section class="space-y-2">
      <h3 class="text-sm font-medium">My themes</h3>
      <p
        v-if="custom.length === 0"
        class="text-xs text-muted-foreground"
        data-testid="appearance-gallery-empty"
      >
        No custom themes yet. Use “Customize” on a built-in theme, or “Create theme from current”
        above, to start one.
      </p>
      <ul v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="appearance-gallery-custom">
        <AppearanceThemeCard
          v-for="entry in custom"
          :key="entry.theme.id"
          :entry="entry"
          :active="entry.theme.id === activeId"
          :previewing="entry.theme.id === previewingId"
          :editing="editing"
          @use="emit('use', entry.theme.id)"
          @preview="emit('preview', entry.theme.id)"
          @edit="emit('edit', entry.theme.id)"
          @delete="emit('delete', entry.theme.id)"
        />
      </ul>
    </section>
  </div>
</template>
