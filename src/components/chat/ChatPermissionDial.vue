<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckIcon, ShieldIcon, ShieldCheckIcon, ShieldOffIcon } from '@lucide/vue'
import type { PermissionLevel } from '@/types/harness/permission'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/shadcn/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import { Button } from '@/components/shadcn/ui/button'

const props = defineProps<{
  modelValue: PermissionLevel
}>()

const emit = defineEmits<{
  'update:modelValue': [value: PermissionLevel]
}>()

const showBypassWarning = ref(false)
const open = ref(false)

type LevelMeta = {
  label: string
  description: string
  icon: typeof ShieldIcon
  class: string
}

const LEVELS: Record<PermissionLevel, LevelMeta> = {
  ask: {
    label: 'Ask',
    description: 'Prompt before each write, shell, git, or MCP action.',
    icon: ShieldIcon,
    class: 'text-foreground',
  },
  allowlist: {
    label: 'Allowlist',
    description: 'Auto-approve paths matching your glob allowlist; ask for the rest.',
    icon: ShieldCheckIcon,
    class: 'text-blue-500',
  },
  bypass: {
    label: 'Bypass',
    description:
      'Skip prompts for file writes, deletes, and git writes. Shell and MCP still ask.',
    icon: ShieldOffIcon,
    class: 'text-amber-500',
  },
}

const currentMeta = computed(() => LEVELS[props.modelValue])

const tooltipLabel = computed(
  () => `Permission: ${currentMeta.value.label}`,
)

const handleSelect = (level: PermissionLevel): void => {
  if (level === 'bypass' && props.modelValue !== 'bypass') {
    open.value = false
    showBypassWarning.value = true
    return
  }
  emit('update:modelValue', level)
}

const confirmBypass = (): void => {
  showBypassWarning.value = false
  emit('update:modelValue', 'bypass')
}

const cancelBypass = (): void => {
  showBypassWarning.value = false
}
</script>

<template>
  <AlertDialog v-model:open="showBypassWarning">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Enable bypass mode?</AlertDialogTitle>
        <AlertDialogDescription>
          Bypass mode skips permission prompts for file writes, deletes, and git
          writes. Shell and MCP tool calls still require approval. Only enable
          this if you trust the current task fully.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="cancelBypass">
          Cancel
        </AlertDialogCancel>
        <AlertDialogAction @click="confirmBypass">
          Enable bypass
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <Tooltip :disable-closing-trigger="true">
    <TooltipTrigger as-child>
      <span class="inline-flex shrink-0">
        <DropdownMenu v-model:open="open">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              class="h-7 w-7 shrink-0"
              :aria-label="tooltipLabel"
            >
              <component
                :is="currentMeta.icon"
                class="size-3.5"
                :class="currentMeta.class"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-60">
            <DropdownMenuItem
              v-for="(meta, level) in LEVELS"
              :key="level"
              class="flex flex-col items-start gap-0.5 py-2"
              @select="handleSelect(level as PermissionLevel)"
            >
              <div class="flex w-full items-center gap-2">
                <component
                  :is="meta.icon"
                  class="size-4 shrink-0"
                  :class="meta.class"
                />
                <span
                  class="font-medium"
                  :class="{ 'text-foreground': modelValue === level }"
                >
                  {{ meta.label }}
                </span>
                <CheckIcon
                  v-if="modelValue === level"
                  class="ml-auto size-3.5 shrink-0 text-foreground"
                  aria-hidden="true"
                />
              </div>
              <p class="ml-6 text-xs text-muted-foreground">{{ meta.description }}</p>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    </TooltipTrigger>
    <TooltipContent class="z-[100]">{{ tooltipLabel }}</TooltipContent>
  </Tooltip>
</template>
