<script setup lang="ts">
import { ref } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/shadcn/ui/form'
import { Input } from '@/components/shadcn/ui/input'
import { Textarea } from '@/components/shadcn/ui/textarea'
import VixlFileCreateSheet from '@/components/settings/vixl-files/VixlFileCreateSheet.vue'
import { createRuleInputSchema } from '@/schemas/rules/rule-document'
import writeRule from '@/services/rules/write-rule'

const props = defineProps<{
  open: boolean
  scope: 'personal' | 'project'
  projectRoot?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submitted'): void
}>()

const saving = ref(false)

const { handleSubmit } = useForm({
  validationSchema: toTypedSchema(createRuleInputSchema),
  initialValues: {
    name: '',
    body: '',
  },
})

const onSubmit = handleSubmit(async (values) => {
  saving.value = true
  try {
    await writeRule({
      scope: props.scope,
      projectRoot: props.projectRoot,
      name: values.name,
      body: values.body,
    })
    toast.success('Rule created')
    emit('submitted')
    emit('update:open', false)
  } catch (error) {
    toast.error('Failed to create rule', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    saving.value = false
  }
})
</script>

<template>
  <VixlFileCreateSheet
    :open="open"
    @update:open="emit('update:open', $event)"
  >
    <form class="space-y-4" @submit="onSubmit">
      <FormField v-slot="{ componentField }" name="name">
        <FormItem>
          <FormLabel>Name</FormLabel>
          <FormControl>
            <Input type="text" placeholder="Rule name" v-bind="componentField" />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField }" name="body">
        <FormItem>
          <FormLabel>Body</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Rule markdown"
              class="min-h-40"
              v-bind="componentField"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <Button type="submit" class="w-full" :disabled="saving">
        {{ saving ? 'Creating...' : 'Create rule' }}
      </Button>
    </form>
  </VixlFileCreateSheet>
</template>
