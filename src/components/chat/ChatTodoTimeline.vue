<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed } from 'vue'
import type { TodoItem } from '@/types/harness/harness-event'
import { Task, TaskContent, TaskItem, TaskTrigger } from '@/components/ai-elements/task'
import { cn } from '@/lib/utils'

const props = defineProps<{
  todos: TodoItem[]
}>()

const completedCount = computed(
  () => props.todos.filter((todo) => todo.status === 'completed').length,
)

const inProgressCount = computed(
  () => props.todos.filter((todo) => todo.status === 'in_progress').length,
)

const triggerTitle = computed(() => {
  if (props.todos.length === 0) {
    return 'Tasks'
  }
  return `Tasks (${completedCount.value}/${props.todos.length})`
})

const defaultOpen = computed(() => inProgressCount.value > 0)

const statusIcon = (status: TodoItem['status']) => {
  if (status === 'completed') {
    return 'circle-check-big'
  }
  if (status === 'in_progress') {
    return 'circle-dot'
  }
  if (status === 'cancelled') {
    return 'circle-x'
  }
  if (status === 'pending') {
    return 'circle-dashed'
  }
  return 'circle'
}

const statusIconClass = (status: TodoItem['status']): string => {
  if (status === 'completed') {
    return 'text-emerald-500'
  }
  if (status === 'in_progress') {
    return 'text-primary'
  }
  if (status === 'cancelled') {
    return 'text-muted-foreground'
  }
  return 'text-muted-foreground'
}

const statusTextClass = (status: TodoItem['status']): string => {
  if (status === 'cancelled') {
    return 'text-muted-foreground line-through'
  }
  return 'text-muted-foreground'
}
</script>

<template>
  <Task
    v-if="todos.length > 0"
    :key="`${defaultOpen}:${todos.length}:${completedCount}`"
    :default-open="defaultOpen"
    class="not-prose w-full min-w-0"
  >
    <TaskTrigger :title="triggerTitle">
      <div
        class="flex w-fit max-w-full cursor-pointer items-center gap-1.5 text-muted-foreground text-xs font-medium transition-colors hover:text-foreground"
      >
        <AppIcon name="list-todo" class="size-3.5 shrink-0" />
        <span class="truncate">{{ triggerTitle }}</span>
        <AppIcon
          name="chevron-down"
          class="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
        />
      </div>
    </TaskTrigger>
    <TaskContent>
      <div class="max-h-40 space-y-1.5 overflow-y-auto">
        <TaskItem v-for="todo in todos" :key="todo.id" class="flex items-start gap-2 text-xs">
          <component
            :is="statusIcon(todo.status)"
            class="mt-0.5 size-3.5 shrink-0"
            :class="statusIconClass(todo.status)"
          />
          <span :class="cn('min-w-0 flex-1', statusTextClass(todo.status))">
            {{ todo.content }}
          </span>
        </TaskItem>
      </div>
    </TaskContent>
  </Task>
</template>
