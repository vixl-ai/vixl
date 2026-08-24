<script setup lang="ts">
import { ref } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { z } from 'zod'
import ModelsOptionsModelOptionsRow from '@/components/models/options/ModelOptionsRow.vue'
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
import AgentToolsInput from '@/components/settings/vixl-files/AgentToolsInput.vue'
import VixlFileCreateSheet from '@/components/settings/vixl-files/VixlFileCreateSheet.vue'
import useVixlConfig from '@/composables/use-vixl-config'
import writeAgent from '@/services/agents/write-agent'

const agentFormSchema = toTypedSchema(
  z.object({
    name: z.string().min(1),
    description: z.string().min(1),
    body: z.string(),
    model: z.string().optional(),
    tools: z.array(z.string()).optional(),
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

const config = useVixlConfig()

const saving = ref(false)

const { handleSubmit, setFieldValue, values } = useForm({
  validationSchema: agentFormSchema,
  initialValues: {
    name: '',
    description: '',
    body: '',
    model: undefined as string | undefined,
    tools: [] as string[],
  },
})

const handleModelChange = (value: string): void => {
  setFieldValue('model', value || undefined)
}

const handleToolsChange = (tools: string[]): void => {
  setFieldValue('tools', tools)
}

const onSubmit = handleSubmit(async (formValues) => {
  saving.value = true
  try {
    await writeAgent({
      scope: props.scope,
      projectRoot: props.projectRoot,
      name: formValues.name,
      description: formValues.description,
      body: formValues.body,
      model: formValues.model?.trim() || undefined,
      tools: formValues.tools && formValues.tools.length > 0 ? formValues.tools : undefined,
    })
    toast.success('Agent created')
    emit('submitted')
    emit('update:open', false)
  } catch (error) {
    toast.error('Failed to create agent', {
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
            <Input type="text" placeholder="Agent name" v-bind="componentField" />
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

      <FormField name="model">
        <FormItem>
          <FormLabel>Model (optional)</FormLabel>
          <ModelsOptionsModelOptionsRow
            :model-value="values.model ?? ''"
            :disabled="saving"
            placeholder="Provider default"
            :options-tab="scope === 'personal' ? 'personal' : 'project'"
            :scope-settings="config.getScopeSettings(scope === 'personal' ? 'personal' : 'project')"
            @update:model-value="handleModelChange"
          />
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField name="tools">
        <FormItem>
          <FormLabel>Tools (optional)</FormLabel>
          <FormControl>
            <AgentToolsInput
              :model-value="values.tools ?? []"
              @update:model-value="handleToolsChange"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <FormField v-slot="{ componentField }" name="body">
        <FormItem>
          <FormLabel>Instructions</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Agent instructions"
              class="min-h-40"
              v-bind="componentField"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <Button type="submit" class="w-full" :disabled="saving">
        {{ saving ? 'Creating...' : 'Create agent' }}
      </Button>
    </form>
  </VixlFileCreateSheet>
</template>
