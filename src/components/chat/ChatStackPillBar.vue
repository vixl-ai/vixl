<script setup lang="ts">
import type { ChatStackId } from '@/types/chat/chat-stack-id'
import {
  BotIcon,
  ListOrderedIcon,
  ListTodoIcon,
  ShieldAlertIcon,
  TerminalIcon,
} from '@lucide/vue'

type ChatStackPill = {
  id: ChatStackId
  label: string
}

const PILL_ICONS: Record<ChatStackId, typeof BotIcon> = {
  subagents: BotIcon,
  approvals: ShieldAlertIcon,
  terminals: TerminalIcon,
  queue: ListOrderedIcon,
  todos: ListTodoIcon,
}

defineProps<{
  pills: ChatStackPill[]
  openStack: ChatStackId | null
}>()

const emit = defineEmits<{
  toggle: [id: ChatStackId]
}>()

const handleToggle = (id: ChatStackId): void => {
  emit('toggle', id)
}
</script>

<template>
  <div
    v-if="pills.length > 0"
    class="flex min-w-0 w-full flex-nowrap items-center gap-1.5 overflow-x-auto overscroll-x-contain scroll-fade-x no-scrollbar"
  >
    <button
      v-for="pill in pills"
      :key="pill.id"
      type="button"
      class="inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors"
      :class="
        pill.id === openStack
          ? 'border-border bg-accent text-accent-foreground'
          : 'border-border/50 bg-sidebar text-muted-foreground hover:text-foreground'
      "
      :aria-pressed="pill.id === openStack"
      @click="handleToggle(pill.id)"
    >
      <component
        :is="PILL_ICONS[pill.id]"
        class="size-3.5 shrink-0"
      />
      <span>{{ pill.label }}</span>
    </button>
  </div>
</template>
