<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed, ref } from 'vue'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/shadcn/ui/input-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/shadcn/ui/tooltip'
import { cn } from '@/lib/utils'

const props = defineProps<{
  id?: string
  placeholder?: string
  class?: string
}>()

const model = defineModel<string>({ default: '' })

const visible = ref(false)

const toggleLabel = computed(() => (visible.value ? 'Hide password' : 'Show password'))

const handleToggle = (): void => {
  visible.value = !visible.value
}
</script>

<template>
  <InputGroup
    :class="cn('has-[[data-slot=input-group-control]:focus-visible]:ring-inset', props.class)"
  >
    <InputGroupInput
      :id="id"
      v-model="model"
      :type="visible ? 'text' : 'password'"
      :placeholder="placeholder"
    />
    <InputGroupAddon align="inline-end">
      <Tooltip>
        <TooltipTrigger as-child>
          <InputGroupButton
            type="button"
            size="icon-xs"
            :aria-label="toggleLabel"
            @click="handleToggle"
          >
            <AppIcon name="eye-off" v-if="visible" />
            <AppIcon name="eye" v-else />
          </InputGroupButton>
        </TooltipTrigger>
        <TooltipContent>{{ toggleLabel }}</TooltipContent>
      </Tooltip>
    </InputGroupAddon>
  </InputGroup>
</template>
