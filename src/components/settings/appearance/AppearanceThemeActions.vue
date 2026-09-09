<script setup lang="ts">
import { AppIcon } from '@/icons'
import { Button } from '@/components/shadcn/ui/button'

defineProps<{
  selectedIsBuiltIn: boolean
  importing: boolean
  exporting: boolean
}>()

const emit = defineEmits<{
  create: []
  edit: []
  duplicate: []
  rename: []
  delete: []
  export: []
  import: []
}>()
</script>

<template>
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label="Create theme from current"
    title="Create theme from current"
    @click="emit('create')"
  >
    <AppIcon name="plus" class="h-4 w-4" />
  </Button>
  <Button
    variant="ghost"
    size="icon-sm"
    :disabled="selectedIsBuiltIn"
    aria-label="Edit selected theme"
    title="Edit selected theme"
    @click="emit('edit')"
  >
    <AppIcon name="pencil" class="h-4 w-4" />
  </Button>
  <Button
    variant="ghost"
    size="icon-sm"
    aria-label="Duplicate selected theme"
    title="Duplicate selected theme"
    @click="emit('duplicate')"
  >
    <AppIcon name="copy" class="h-4 w-4" />
  </Button>
  <Button
    variant="ghost"
    size="icon-sm"
    :disabled="selectedIsBuiltIn"
    aria-label="Rename selected theme"
    title="Rename selected theme"
    @click="emit('rename')"
  >
    <AppIcon name="square-pen" class="h-4 w-4" />
  </Button>
  <Button
    variant="ghost"
    size="icon-sm"
    :disabled="selectedIsBuiltIn"
    aria-label="Delete selected theme"
    title="Delete selected theme"
    @click="emit('delete')"
  >
    <AppIcon name="trash" class="h-4 w-4" />
  </Button>
  <Button
    variant="ghost"
    size="icon-sm"
    :disabled="exporting"
    aria-label="Export selected theme"
    title="Export selected theme"
    @click="emit('export')"
  >
    <AppIcon name="download" class="h-4 w-4" />
  </Button>
  <Button
    variant="ghost"
    size="icon-sm"
    :disabled="importing"
    aria-label="Import a theme file"
    title="Import a theme file"
    @click="emit('import')"
  >
    <AppIcon name="upload" class="h-4 w-4" />
  </Button>
</template>
