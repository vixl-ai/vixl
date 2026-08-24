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
import { createSkillInputSchema } from '@/schemas/skills/skill-document'
import writeSkill from '@/services/skills/write-skill'

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
  validationSchema: toTypedSchema(createSkillInputSchema),
  initialValues: {
    name: '',
    description: '',
    body: '',
  },
})

const onSubmit = handleSubmit(async (values) => {
  saving.value = true
  try {
    await writeSkill({
      scope: props.scope,
      projectRoot: props.projectRoot,
      name: values.name,
      description: values.description,
      body: values.body,
    })
    toast.success('Skill created')
    emit('submitted')
    emit('update:open', false)
  } catch (error) {
    toast.error('Failed to create skill', {
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
            <Input type="text" placeholder="Skill name" v-bind="componentField" />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField }" name="description">
        <FormItem>
          <FormLabel>Description</FormLabel>
          <FormControl>
            <Input
              type="text"
              placeholder="Short description"
              v-bind="componentField"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField }" name="body">
        <FormItem>
          <FormLabel>Body</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Skill instructions"
              class="min-h-40"
              v-bind="componentField"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <Button type="submit" class="w-full" :disabled="saving">
        {{ saving ? 'Creating...' : 'Create skill' }}
      </Button>
    </form>
  </VixlFileCreateSheet>
</template>
