<script setup lang="ts">
import { toast } from 'vue-sonner'
import ModelsOptionsModelOptionsRow from '@/components/models/options/ModelOptionsRow.vue'
import { Button } from '@/components/shadcn/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/shadcn/ui/dialog'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import listConfiguredProviders from '@/services/providers/list-configured-providers'

const props = defineProps<{
  open: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  confirm: [payload: {
    model: string
    freshChat: boolean
  }]
}>()

const config = useVixlConfig()
const model = ref('')
const freshChat = ref(false)

const settings = computed(() => config.effectiveSettings.value)

const hasProviders = computed(
  () => listConfiguredProviders(settings.value).length > 0,
)

const canConfirm = computed(
  () =>
    hasProviders.value &&
    model.value.trim().length > 0 &&
    !props.disabled,
)

const syncDefaults = (): void => {
  model.value = resolveModelForRole('agent', settings.value) ?? ''
  freshChat.value = false
}

watch(
  () => [props.open, config.hydrated.value] as const,
  ([open, hydrated]) => {
    if (open && hydrated) {
      syncDefaults()
    }
  },
  { immediate: true },
)

const handleOpenChange = (open: boolean): void => {
  emit('update:open', open)
}

const handleModelChange = (value: string): void => {
  if (value.length > 0) {
    model.value = value
  }
}

const handleConfirm = (): void => {
  if (!model.value.trim()) {
    toast.error('Select a model')
    return
  }
  emit('confirm', {
    model: model.value.trim(),
    freshChat: freshChat.value,
  })
  emit('update:open', false)
}
</script>

<template>
  <Dialog :open="open" @update:open="handleOpenChange">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Build plan</DialogTitle>
        <DialogDescription>
          Defaults come from Models settings (Agent). You can override the model for this run.
        </DialogDescription>
      </DialogHeader>
      <div class="space-y-4 py-2">
        <div class="space-y-2">
          <p class="text-sm font-medium">Model</p>
          <ModelsOptionsModelOptionsRow
            :model-value="model"
            :scope-settings="settings"
            hide-disallowed
            :disabled="!hasProviders || disabled"
            placeholder="Select model"
            @update:model-value="handleModelChange"
          />
        </div>
        <div class="flex items-center gap-2">
          <Checkbox
            id="build-plan-fresh-chat"
            v-model="freshChat"
            :disabled="disabled"
          />
          <Label for="build-plan-fresh-chat">
            Build in a fresh chat (new context)
          </Label>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" @click="handleOpenChange(false)">
          Cancel
        </Button>
        <Button :disabled="!canConfirm" @click="handleConfirm">
          Build
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
