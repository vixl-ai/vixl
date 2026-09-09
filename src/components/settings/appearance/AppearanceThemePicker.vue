<script setup lang="ts">
import AppearanceThemeActions from './AppearanceThemeActions.vue'
import AppearanceThemeGallery from './AppearanceThemeGallery.vue'
import { Button } from '@/components/shadcn/ui/button'
import { Label } from '@/components/shadcn/ui/label'
import { NativeSelect } from '@/components/shadcn/ui/native-select'
import type { GalleryTheme } from './appearance-gallery-ui'
import type { VixlThemeVariantKind } from '@/types/appearance/theme'

/**
 * Theme selection UI for the Appearance section: the grouped visual gallery
 * (wide layouts), a compact select fallback for narrow layouts, the
 * create/edit/share toolbar, and the gallery live-preview status bar with its
 * explicit apply/exit flow.
 *
 * The compact select's option list is derived from the same grouped gallery
 * data (built-ins first, then personal themes) so the two stay in sync.
 */
const props = defineProps<{
  selectedThemeId: string
  selectedIsBuiltIn: boolean
  importing: boolean
  exporting: boolean
  builtIn: GalleryTheme[]
  custom: GalleryTheme[]
  previewingId: string | null
  editing: boolean
  previewingThemeName: string | null
  previewVariant: VixlThemeVariantKind
}>()

const themeOptions = (): Array<{ id: string; name: string }> => [
  ...props.builtIn.map((entry) => ({ id: entry.theme.id, name: entry.theme.name })),
  ...props.custom.map((entry) => ({ id: entry.theme.id, name: entry.theme.name })),
]

const emit = defineEmits<{
  select: [id: string]
  create: []
  edit: []
  duplicate: []
  rename: []
  delete: []
  export: []
  import: []
  'gallery-use': [id: string]
  'gallery-preview': [id: string]
  'gallery-customize': [id: string]
  'gallery-edit': [id: string]
  'gallery-delete': [id: string]
  'preview-apply': []
  'preview-exit': []
}>()
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-sm font-medium">Theme</h2>
      <AppearanceThemeActions
        :selected-is-built-in="selectedIsBuiltIn"
        :importing="importing"
        :exporting="exporting"
        @create="emit('create')"
        @edit="emit('edit')"
        @duplicate="emit('duplicate')"
        @rename="emit('rename')"
        @delete="emit('delete')"
        @export="emit('export')"
        @import="emit('import')"
      />
    </div>

    <!-- Compact select fallback for narrow layouts -->
    <div class="space-y-1 sm:hidden">
      <Label for="appearance-theme-select">Theme</Label>
      <NativeSelect
        id="appearance-theme-select"
        :model-value="selectedThemeId"
        class="w-56"
        aria-label="Active appearance theme"
        @change="emit('select', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="option in themeOptions()" :key="option.id" :value="option.id">
          {{ option.name }}
        </option>
      </NativeSelect>
    </div>

    <!-- Grouped visual gallery (wide layouts) -->
    <div class="hidden sm:block">
      <AppearanceThemeGallery
        :built-in="builtIn"
        :custom="custom"
        :active-id="selectedThemeId"
        :previewing-id="previewingId"
        :editing="editing"
        @use="emit('gallery-use', $event)"
        @preview="emit('gallery-preview', $event)"
        @customize="emit('gallery-customize', $event)"
        @edit="emit('gallery-edit', $event)"
        @delete="emit('gallery-delete', $event)"
      />
    </div>

    <!-- Gallery live-preview status bar: explicit preview/apply flow -->
    <div
      v-if="previewingThemeName"
      role="status"
      class="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 p-3"
      data-testid="appearance-gallery-preview-bar"
    >
      <p class="min-w-0 flex-1 text-sm">
        Previewing “{{ previewingThemeName }}” ({{ previewVariant }} variant). Nothing is saved
        until you apply.
      </p>
      <div class="flex items-center gap-2">
        <Button size="sm" data-testid="appearance-gallery-preview-apply" @click="emit('preview-apply')">
          Use this theme
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-testid="appearance-gallery-preview-exit"
          @click="emit('preview-exit')"
        >
          Exit preview
        </Button>
      </div>
    </div>
  </div>
</template>
