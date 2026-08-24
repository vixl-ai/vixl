<script setup lang="ts">
import { ref } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { z } from 'zod'
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
import writeStudio from '@/services/studio/write-studio'

const studioFormSchema = toTypedSchema(
  z.object({
    title: z.string().min(1),
    slug: z.string().optional(),
    content: z.string(),
  }),
)

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
  validationSchema: studioFormSchema,
  initialValues: {
    title: '',
    slug: undefined as string | undefined,
    content: '',
  },
})

const onSubmit = handleSubmit(async (values) => {
  saving.value = true
  try {
    await writeStudio({
      scope: props.scope,
      projectRoot: props.projectRoot,
      title: values.title,
      slug: values.slug?.trim() || undefined,
      content: values.content,
    })
    toast.success('Studio created')
    emit('submitted')
    emit('update:open', false)
  } catch (error) {
    toast.error('Failed to create studio', {
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
      <FormField v-slot="{ componentField }" name="title">
        <FormItem>
          <FormLabel>Title</FormLabel>
          <FormControl>
            <Input type="text" placeholder="Studio title" v-bind="componentField" />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField }" name="slug">
        <FormItem>
          <FormLabel>Slug (optional)</FormLabel>
          <FormControl>
            <Input
              type="text"
              placeholder="kebab-case-slug"
              v-bind="componentField"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField }" name="content">
        <FormItem>
          <FormLabel>Content</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Studio markdown content"
              class="min-h-40"
              v-bind="componentField"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <Button type="submit" class="w-full" :disabled="saving">
        {{ saving ? 'Creating...' : 'Create studio' }}
      </Button>
    </form>
  </VixlFileCreateSheet>
</template>
