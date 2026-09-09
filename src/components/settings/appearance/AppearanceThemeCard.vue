<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed } from 'vue'
import { Button } from '@/components/shadcn/ui/button'
import AppearanceThemeSwatch from './AppearanceThemeSwatch.vue'
import {
  canvasSummaryLabel,
  glassBadgeLabel,
  iconPackLabel,
  themeCardAriaLabel,
  type GalleryTheme,
} from './appearance-gallery-ui'

/**
 * One gallery theme card: dual light/dark swatch thumbnails built from the
 * theme's real tokens/canvas/icons, glass and canvas badges, and quick
 * Preview/Use/Customize actions. Selecting a card (its main control) only
 * applies the theme — it never begins editing; built-ins expose Customize
 * (duplicate into a custom theme) instead of Edit/Delete.
 */
const props = defineProps<{
  entry: GalleryTheme
  active: boolean
  previewing: boolean
  /** True while the draft editor is open; preview is paused then. */
  editing: boolean
}>()

const emit = defineEmits<{
  use: []
  preview: []
  customize: []
  edit: []
  delete: []
}>()

const theme = computed(() => props.entry.theme)
const name = computed(() => theme.value.name)
const ariaLabel = computed(() =>
  themeCardAriaLabel(theme.value, props.entry.group, props.active),
)
</script>

<template>
  <li
    class="relative rounded-lg border p-3"
    :class="active ? 'border-primary ring-1 ring-primary' : 'border-border'"
    :data-active="active"
    data-testid="appearance-theme-card"
  >
    <span
      v-if="active"
      class="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground"
      data-testid="appearance-card-active-badge"
    >
      <AppIcon name="check" class="h-3 w-3" />
      Active
    </span>
    <span
      v-else-if="previewing"
      class="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-foreground"
      data-testid="appearance-card-preview-badge"
    >
      <AppIcon name="eye" class="h-3 w-3" />
      Previewing
    </span>

    <!-- Main select control: applies the theme; never edits. -->
    <button
      type="button"
      class="block w-full rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      :aria-pressed="active"
      :aria-label="ariaLabel"
      data-theme-card-button
      data-testid="appearance-theme-card-select"
      @click="emit('use')"
    >
      <div class="flex gap-1.5">
        <AppearanceThemeSwatch :variant-theme="theme.variants.light" variant-kind="light" />
        <AppearanceThemeSwatch :variant-theme="theme.variants.dark" variant-kind="dark" />
      </div>
      <span class="mt-2 block max-w-[80%] truncate text-sm font-medium">{{ name }}</span>
    </button>

    <p class="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
      <span data-testid="appearance-card-glass-badge">{{
        glassBadgeLabel(theme.variants.light.glass)
      }}</span>
      <span aria-hidden="true">·</span>
      <span data-testid="appearance-card-canvas">{{
        canvasSummaryLabel(theme.variants.light.canvas)
      }}</span>
      <span aria-hidden="true">·</span>
      <span data-testid="appearance-card-icon-pack">{{
        `${iconPackLabel(theme.variants.light.icons.pack)} icons`
      }}</span>
    </p>

    <div class="mt-2 flex flex-wrap items-center gap-1" role="group" :aria-label="`Actions for ${name}`">
      <Button
        v-if="previewing"
        variant="outline"
        size="sm"
        data-testid="appearance-card-preview"
        aria-label="Exit preview"
        @click="emit('preview')"
      >
        <AppIcon name="eye-off" class="h-3.5 w-3.5" />
        Exit preview
      </Button>
      <Button
        v-else
        variant="ghost"
        size="sm"
        :disabled="editing"
        data-testid="appearance-card-preview"
        :aria-label="`Preview ${name}`"
        @click="emit('preview')"
      >
        <AppIcon name="eye" class="h-3.5 w-3.5" />
        Preview
      </Button>
      <Button
        v-if="!active"
        variant="ghost"
        size="sm"
        data-testid="appearance-card-use"
        :aria-label="`Use ${name}`"
        @click="emit('use')"
      >
        <AppIcon name="check" class="h-3.5 w-3.5" />
        Use
      </Button>
      <Button
        v-if="entry.builtIn"
        variant="ghost"
        size="sm"
        data-testid="appearance-card-customize"
        :aria-label="`Customize ${name} (creates an editable copy)`"
        @click="emit('customize')"
      >
        <AppIcon name="copy" class="h-3.5 w-3.5" />
        Customize
      </Button>
      <template v-else>
        <Button
          variant="ghost"
          size="sm"
          data-testid="appearance-card-edit"
          :aria-label="`Edit ${name}`"
          @click="emit('edit')"
        >
          <AppIcon name="pencil" class="h-3.5 w-3.5" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          data-testid="appearance-card-delete"
          :aria-label="`Delete ${name}`"
          @click="emit('delete')"
        >
          <AppIcon name="trash" class="h-3.5 w-3.5" />
          Delete
        </Button>
      </template>
    </div>
  </li>
</template>
