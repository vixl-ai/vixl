<script setup lang="ts">
import { AppIcon } from '@/icons'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import { Label } from '@/components/shadcn/ui/label'
import AppearanceBackgroundEditor from './AppearanceBackgroundEditor.vue'
import AppearanceColorField from './AppearanceColorField.vue'
import AppearanceGlassEditor from './AppearanceGlassEditor.vue'
import AppearanceIconEditor from './AppearanceIconEditor.vue'
import AppearancePreview from './AppearancePreview.vue'
import AppearanceTypographyEditor from './AppearanceTypographyEditor.vue'
import { ADVANCED_TOKEN_FIELDS, CORE_TOKEN_FIELDS, contrastTargetFor } from './appearance-ui'
import type { AppearanceEditorSection } from './use-appearance-editor'
import type {
  VixlThemeDefinition,
  VixlThemeSemanticTokens,
  VixlThemeTypography,
  VixlThemeCanvas,
  VixlThemeGlass,
  VixlThemeIconAppearance,
  VixlThemeVariantKind,
} from '@/types/appearance/theme'

defineProps<{
  draft: VixlThemeDefinition
  editingVariant: VixlThemeVariantKind
  isDirty: boolean
  isDraftValid: boolean
  applying?: boolean
}>()

const emit = defineEmits<{
  rename: [value: string]
  'set-variant': [variant: VixlThemeVariantKind]
  'set-token': [key: keyof VixlThemeSemanticTokens, value: string]
  'set-typography': [patch: Partial<VixlThemeTypography>]
  'set-canvas': [canvas: VixlThemeCanvas]
  'set-glass': [glass: VixlThemeGlass]
  'set-icons': [icons: VixlThemeIconAppearance]
  'reset-variant': []
  'reset-section': [section: AppearanceEditorSection]
  apply: []
  cancel: []
}>()
</script>

<template>
  <div class="space-y-6 rounded-lg border border-border p-4" data-testid="appearance-theme-editor">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <Label for="appearance-draft-name">Name</Label>
        <Input
          id="appearance-draft-name"
          class="h-8 w-56"
          :model-value="draft.name"
          maxlength="64"
          aria-label="Theme name"
          @update:model-value="(value: string | number) => emit('rename', String(value))"
        />
        <span v-if="isDirty" class="text-xs text-muted-foreground"> Unsaved changes </span>
      </div>
      <div class="flex items-center gap-2">
        <div class="flex items-center gap-1" role="group" aria-label="Edit variant">
          <Button
            variant="ghost"
            size="sm"
            :class="
              editingVariant === 'light' ? 'bg-muted text-foreground' : 'text-muted-foreground'
            "
            :aria-pressed="editingVariant === 'light'"
            @click="emit('set-variant', 'light')"
          >
            Light variant
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :class="
              editingVariant === 'dark' ? 'bg-muted text-foreground' : 'text-muted-foreground'
            "
            :aria-pressed="editingVariant === 'dark'"
            @click="emit('set-variant', 'dark')"
          >
            Dark variant
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Reset current variant to Vixl defaults"
          @click="emit('reset-variant')"
        >
          <AppIcon name="rotate-ccw" class="h-4 w-4" />
          Reset variant
        </Button>
      </div>
    </div>

    <!-- Core semantic colors -->
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <p class="text-sm font-medium">Semantic colors</p>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Reset colors to Vixl defaults"
          data-testid="appearance-reset-colors"
          @click="emit('reset-section', 'colors')"
        >
          <AppIcon name="rotate-ccw" class="h-3 w-3" />
          Reset
        </Button>
      </div>
      <div class="grid gap-2 lg:grid-cols-2">
        <AppearanceColorField
          v-for="token in CORE_TOKEN_FIELDS"
          :key="token.key"
          :label="token.label"
          :model-value="draft.variants[editingVariant].colors[token.key]"
          :contrast-against="contrastTargetFor(token.key, draft.variants[editingVariant].colors)"
          @update:model-value="(value: string) => emit('set-token', token.key, value)"
        />
      </div>
    </div>

    <!-- Advanced tokens (collapsed by default) -->
    <AppearanceEditorSection
      title="Advanced tokens (charts, sidebar)"
      testid="appearance-editor-advanced"
    >
      <div class="grid gap-2 lg:grid-cols-2">
        <AppearanceColorField
          v-for="token in ADVANCED_TOKEN_FIELDS"
          :key="token.key"
          :label="token.label"
          :model-value="draft.variants[editingVariant].colors[token.key]"
          :contrast-against="contrastTargetFor(token.key, draft.variants[editingVariant].colors)"
          @update:model-value="(value: string) => emit('set-token', token.key, value)"
        />
      </div>
    </AppearanceEditorSection>

    <!-- Typography (collapsed by default; reset stays visible) -->
    <AppearanceEditorSection
      title="Typography"
      reset-label="Reset typography to Vixl defaults"
      reset-testid="appearance-reset-typography"
      testid="appearance-editor-section-typography"
      @reset="emit('reset-section', 'typography')"
    >
      <AppearanceTypographyEditor
        :typography="draft.variants[editingVariant].typography"
        @update="(patch) => emit('set-typography', patch)"
      />
    </AppearanceEditorSection>

    <!-- Background (collapsed by default; reset stays visible) -->
    <AppearanceEditorSection
      title="Canvas background"
      reset-label="Reset canvas background to Vixl defaults"
      reset-testid="appearance-reset-background"
      testid="appearance-editor-section-background"
      @reset="emit('reset-section', 'background')"
    >
      <AppearanceBackgroundEditor
        :canvas="draft.variants[editingVariant].canvas"
        @update:canvas="(canvas) => emit('set-canvas', canvas)"
      />
    </AppearanceEditorSection>

    <!-- Glass surfaces (collapsed by default; reset stays visible) -->
    <AppearanceEditorSection
      title="Glass surfaces"
      reset-label="Reset glass surfaces to Vixl defaults"
      reset-testid="appearance-reset-glass"
      testid="appearance-editor-section-glass"
      @reset="emit('reset-section', 'glass')"
    >
      <AppearanceGlassEditor
        :glass="draft.variants[editingVariant].glass"
        @update:glass="(glass) => emit('set-glass', glass)"
      />
    </AppearanceEditorSection>

    <!-- Icons (collapsed by default; reset stays visible) -->
    <AppearanceEditorSection
      title="Icons"
      reset-label="Reset icons to Vixl defaults"
      reset-testid="appearance-reset-icons"
      testid="appearance-editor-section-icons"
      @reset="emit('reset-section', 'icons')"
    >
      <AppearanceIconEditor
        :icons="draft.variants[editingVariant].icons"
        @update:icons="(icons) => emit('set-icons', icons)"
      />
    </AppearanceEditorSection>

    <!-- Live preview -->
    <AppearancePreview
      :variant-theme="draft.variants[editingVariant]"
      :variant-kind="editingVariant"
    />

    <div class="flex items-center gap-2">
      <Button :disabled="!isDraftValid || applying" @click="emit('apply')"> Apply and save </Button>
      <Button variant="outline" @click="emit('cancel')"> Cancel </Button>
      <span v-if="!isDraftValid" class="text-xs text-destructive" role="alert">
        Fix invalid colors before applying.
      </span>
    </div>
  </div>
</template>
