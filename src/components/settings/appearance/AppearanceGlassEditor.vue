<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@/components/shadcn/ui/button'
import { Checkbox } from '@/components/shadcn/ui/checkbox'
import { NativeSelect } from '@/components/shadcn/ui/native-select'
import {
  THEME_GLASS_BLUR_MAX,
  THEME_GLASS_SATURATION_MAX,
  THEME_GLASS_SATURATION_MIN,
} from '@/schemas/appearance/theme'
import {
  THEME_GLASS_RADIUS_PRESETS,
  THEME_GLASS_SCOPES,
  THEME_GLASS_SHADOW_PRESETS,
  type VixlThemeGlass,
  type VixlThemeGlassRadiusPreset,
  type VixlThemeGlassScope,
  type VixlThemeGlassShadowPreset,
} from '@/types/appearance/theme'
import {
  GLASS_PRESETS,
  GLASS_SCOPE_LABELS,
  clampGlassBlur,
  clampGlassBorderOpacity,
  clampGlassOpacity,
  clampGlassSaturation,
  glassPresetIdFor,
  glassTranslucencyWarnings,
} from './appearance-glass-ui'

const props = defineProps<{
  glass: VixlThemeGlass
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:glass': [glass: VixlThemeGlass]
}>()

type GlassPresetIdOf = (typeof GLASS_PRESETS)[number]['id']

const activePresetId = computed(() => glassPresetIdFor(props.glass))

const glassWarnings = computed(() => glassTranslucencyWarnings(props.glass))

const selectPreset = (id: GlassPresetIdOf): void => {
  const preset = GLASS_PRESETS.find((entry) => entry.id === id)
  if (preset) {
    emit('update:glass', { ...preset.glass, scopes: [...preset.glass.scopes] })
  }
}

const patchGlass = (patch: Partial<VixlThemeGlass>): void => {
  // Preserve the enabled state through advanced edits; values are sanitized
  // again by the editor composable before the draft is stored.
  emit('update:glass', {
    ...props.glass,
    enabled: props.glass.enabled,
    ...patch,
  })
}

const handleScopeToggle = (scope: VixlThemeGlassScope, checked: boolean): void => {
  const scopes = checked
    ? [...props.glass.scopes, scope]
    : props.glass.scopes.filter((entry) => entry !== scope)
  patchGlass({ scopes })
}

const handleSurfaceOpacity = (value: string | number): void => {
  patchGlass({ surfaceOpacity: clampGlassOpacity(Number(value)) })
}

const handleBlur = (value: string | number): void => {
  patchGlass({ blur: clampGlassBlur(Number(value)) })
}

const handleSaturation = (value: string | number): void => {
  patchGlass({ saturation: clampGlassSaturation(Number(value)) })
}

const handleBorderOpacity = (value: string | number): void => {
  patchGlass({ borderOpacity: clampGlassBorderOpacity(Number(value)) })
}

const handleShadow = (event: Event): void => {
  patchGlass({ shadow: (event.target as HTMLSelectElement).value as VixlThemeGlassShadowPreset })
}

const handleRadius = (event: Event): void => {
  patchGlass({ radius: (event.target as HTMLSelectElement).value as VixlThemeGlassRadiusPreset })
}
</script>

<template>
  <div class="space-y-4" data-testid="appearance-glass-editor">
    <div class="flex flex-wrap items-center gap-1" role="group" aria-label="Glass preset">
      <Button
        v-for="preset in GLASS_PRESETS"
        :key="preset.id"
        variant="ghost"
        size="sm"
        :class="activePresetId === preset.id ? 'bg-muted text-foreground' : 'text-muted-foreground'"
        :aria-pressed="activePresetId === preset.id"
        :disabled="disabled"
        @click="selectPreset(preset.id)"
      >
        {{ preset.label }}
      </Button>
      <span v-if="activePresetId === null" class="text-xs text-muted-foreground">
        Custom glass settings
      </span>
    </div>

    <p class="text-xs text-muted-foreground">
      Glass applies one bounded blur to top-level sidebar, panel, and overlay surfaces. Translucency
      is reduced automatically when the OS requests less transparency or more contrast.
    </p>

    <template v-if="glass.enabled">
      <fieldset class="space-y-2" :disabled="disabled">
        <legend class="text-sm font-medium">Glass scopes</legend>
        <div class="flex flex-col gap-2">
          <label
            v-for="scope in THEME_GLASS_SCOPES"
            :key="scope"
            class="flex items-center gap-2 text-sm"
          >
            <Checkbox
              :model-value="glass.scopes.includes(scope)"
              :aria-label="`Glass scope: ${GLASS_SCOPE_LABELS[scope]}`"
              :disabled="disabled"
              @update:model-value="
                (checked: boolean | 'indeterminate') => handleScopeToggle(scope, checked === true)
              "
            />
            {{ GLASS_SCOPE_LABELS[scope] }}
          </label>
        </div>
      </fieldset>

      <div class="grid gap-3 lg:grid-cols-2">
        <AppearanceGlassRangeField
          id="appearance-glass-opacity"
          label="Surface opacity"
          :model-value="glass.surfaceOpacity"
          :min="0"
          :max="100"
          unit="%"
          :disabled="disabled"
          @update:model-value="handleSurfaceOpacity"
        />
        <AppearanceGlassRangeField
          id="appearance-glass-blur"
          label="Blur"
          :model-value="glass.blur"
          :min="0"
          :max="THEME_GLASS_BLUR_MAX"
          unit="px"
          :disabled="disabled"
          @update:model-value="handleBlur"
        />
        <AppearanceGlassRangeField
          id="appearance-glass-saturation"
          label="Saturation"
          :model-value="glass.saturation"
          :min="THEME_GLASS_SATURATION_MIN"
          :max="THEME_GLASS_SATURATION_MAX"
          :step="5"
          unit="%"
          :disabled="disabled"
          @update:model-value="handleSaturation"
        />
        <AppearanceGlassRangeField
          id="appearance-glass-border-opacity"
          label="Border opacity"
          :model-value="glass.borderOpacity"
          :min="0"
          :max="100"
          unit="%"
          :disabled="disabled"
          @update:model-value="handleBorderOpacity"
        />

        <div class="flex items-center gap-3">
          <label for="appearance-glass-shadow" class="min-w-36 text-sm"> Shadow </label>
          <NativeSelect
            id="appearance-glass-shadow"
            class="h-8 w-32"
            :model-value="glass.shadow"
            :disabled="disabled"
            aria-label="Glass shadow preset"
            @change="handleShadow"
          >
            <option v-for="shadow in THEME_GLASS_SHADOW_PRESETS" :key="shadow" :value="shadow">
              {{ shadow }}
            </option>
          </NativeSelect>
        </div>

        <div class="flex items-center gap-3">
          <label for="appearance-glass-radius" class="min-w-36 text-sm"> Corner radius </label>
          <NativeSelect
            id="appearance-glass-radius"
            class="h-8 w-32"
            :model-value="glass.radius"
            :disabled="disabled"
            aria-label="Glass corner radius preset"
            @change="handleRadius"
          >
            <option v-for="radius in THEME_GLASS_RADIUS_PRESETS" :key="radius" :value="radius">
              {{ radius }}
            </option>
          </NativeSelect>
        </div>
      </div>

      <ul
        v-if="glassWarnings.length > 0"
        class="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400"
        role="status"
        data-testid="appearance-glass-warnings"
      >
        <li v-for="warning in glassWarnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
    </template>
  </div>
</template>
