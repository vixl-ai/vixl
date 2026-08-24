<script setup lang="ts">
import { ref } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
import { useForm } from 'vee-validate'
import { toast } from 'vue-sonner'
import { nanoid } from 'nanoid'
import { z } from 'zod'
import { Plus, Trash2 } from '@lucide/vue'
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import VixlFileCreateSheet from '@/components/settings/vixl-files/VixlFileCreateSheet.vue'
import createPlan from '@/services/plans/write-plan'
import { fsWriteFile, getVixlDir } from '@/services/vixl/vixl-tauri'
import type { PlanTodoItem } from '@/types/plans/plan-document'

const planFormSchema = toTypedSchema(
  z.object({
    title: z.string().min(1),
    description: z.string(),
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
const todoInputs = ref<string[]>([''])

const { handleSubmit } = useForm({
  validationSchema: planFormSchema,
  initialValues: {
    title: '',
    description: '',
  },
})

const addTodo = (): void => {
  todoInputs.value.push('')
}

const removeTodo = (index: number): void => {
  todoInputs.value.splice(index, 1)
  if (todoInputs.value.length === 0) {
    todoInputs.value.push('')
  }
}

const buildTodos = (): PlanTodoItem[] => {
  return todoInputs.value
    .map((content) => content.trim())
    .filter((content) => content.length > 0)
    .map((content) => ({
      id: nanoid(10),
      content,
      status: 'pending' as const,
    }))
}

const onSubmit = handleSubmit(async (values) => {
  saving.value = true
  try {
    const todos = buildTodos()
    const body = values.description.trim()
    const plan = createPlan({
      title: values.title,
      body,
      todos,
    })

    if (props.scope === 'personal') {
      const personalDir = await getVixlDir('personal')
      const path = plan.path.replace(/^\.vixl\//, '')
      await fsWriteFile({
        projectRoot: personalDir,
        path,
        content: plan.content,
      })
    } else {
      if (!props.projectRoot) {
        throw new Error('projectRoot is required for project-scoped plans')
      }
      await fsWriteFile({
        projectRoot: props.projectRoot,
        path: plan.path,
        content: plan.content,
      })
    }

    toast.success('Plan created')
    emit('submitted')
    emit('update:open', false)
  } catch (error) {
    toast.error('Failed to create plan', {
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
            <Input type="text" placeholder="Plan title" v-bind="componentField" />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium leading-none">Todos</label>
          <Tooltip>
            <TooltipTrigger as-child>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                class="h-6 w-6"
                aria-label="Add todo"
                @click="addTodo"
              >
                <Plus class="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Add todo</TooltipContent>
          </Tooltip>
        </div>
        <div class="space-y-2">
          <div
            v-for="(_, index) in todoInputs"
            :key="index"
            class="flex items-center gap-2"
          >
            <Input
              v-model="todoInputs[index]"
              type="text"
              placeholder="Todo content"
            />
            <Button
              v-if="todoInputs.length > 1"
              type="button"
              variant="ghost"
              size="icon"
              class="h-8 w-8 shrink-0"
              aria-label="Remove todo"
              @click="removeTodo(index)"
            >
              <Trash2 class="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <FormField v-slot="{ componentField }" name="description">
        <FormItem>
          <FormLabel>Description</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Describe the plan"
              class="min-h-32"
              v-bind="componentField"
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      </FormField>

      <Button type="submit" class="w-full" :disabled="saving">
        {{ saving ? 'Creating...' : 'Create plan' }}
      </Button>
    </form>
  </VixlFileCreateSheet>
</template>
