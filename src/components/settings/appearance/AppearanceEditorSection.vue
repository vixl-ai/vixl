<script setup lang="ts">
import { ref } from 'vue'
import { AppIcon } from '@/icons'
import { Button } from '@/components/shadcn/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'

/**
 * Collapsible section header for the appearance theme editor. The optional
 * per-section Reset control stays outside the collapsible body so section
 * resets remain one click away while the editor fields are collapsed.
 */
const props = defineProps<{
  title: string
  defaultOpen?: boolean
  resetLabel?: string
  resetTestid?: string
  testid?: string
}>()

const emit = defineEmits<{
  reset: []
}>()

const open = ref(props.defaultOpen ?? false)
</script>

<template>
  <Collapsible
    :open="open"
    :data-testid="testid"
    @update:open="(value: boolean) => (open = value)"
  >
    <div class="flex items-center justify-between gap-2">
      <CollapsibleTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="font-medium"
          :data-testid="testid ? `${testid}-trigger` : undefined"
        >
          <AppIcon
            name="chevron-down"
            class="h-3 w-3 shrink-0 transition-transform"
            :class="open ? 'rotate-180' : ''"
          />
          {{ title }}
        </Button>
      </CollapsibleTrigger>
      <Button
        v-if="resetLabel"
        variant="ghost"
        size="sm"
        :aria-label="resetLabel"
        :data-testid="resetTestid"
        @click="emit('reset')"
      >
        <AppIcon name="rotate-ccw" class="h-3 w-3" />
        Reset
      </Button>
    </div>
    <CollapsibleContent class="mt-2 space-y-2">
      <slot />
    </CollapsibleContent>
  </Collapsible>
</template>
