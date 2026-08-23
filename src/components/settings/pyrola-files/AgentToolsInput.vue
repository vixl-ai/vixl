<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  TagsInput,
  TagsInputInput,
  TagsInputItem,
  TagsInputItemDelete,
  TagsInputItemText,
} from '@/components/shadcn/ui/tags-input'
import { TOOL_DESCRIPTIONS } from '@/services/harness/tool-catalog'

const props = defineProps<{
  modelValue?: string[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const TOOL_CATEGORIES: Array<{ label: string; tools: string[] }> = [
  {
    label: 'Files',
    tools: [
      'read_file',
      'write_file',
      'edit_file',
      'apply_patch',
      'delete_file',
      'move_file',
      'list_dir',
      'glob_files',
    ],
  },
  {
    label: 'Search',
    tools: [
      'grep',
      'codebase_explore',
      'codebase_search',
      'codebase_impact',
      'codebase_status',
      'lsp',
      'diagnostics',
    ],
  },
  {
    label: 'Git',
    tools: [
      'git_status',
      'git_diff',
      'git_log',
      'git_branch',
      'git_checkout',
      'git_branch_create',
      'git_commit',
    ],
  },
  {
    label: 'Shell',
    tools: ['run_terminal', 'terminal_output', 'stop_terminal'],
  },
  {
    label: 'MCP',
    tools: [
      'call_mcp_tool',
      'get_mcp_tools',
      'list_mcp_resources',
      'read_mcp_resource',
      'get_mcp_prompt',
    ],
  },
  {
    label: 'Plans',
    tools: ['create_plan', 'update_plan_todo', 'update_todos'],
  },
  {
    label: 'Studio',
    tools: ['write_studio_artifact'],
  },
  {
    label: 'Subagents',
    tools: ['spawn_subagent'],
  },
  {
    label: 'Skills',
    tools: ['load_skill'],
  },
  {
    label: 'User',
    tools: ['ask_user'],
  },
]

const AVAILABLE_TOOLS = Object.keys(TOOL_DESCRIPTIONS)

const query = ref('')
const showSuggestions = ref(false)

const selected = computed(() => props.modelValue ?? [])

const filteredGroups = computed(() => {
  const q = query.value.trim().toLowerCase()
  const selectedSet = new Set(selected.value)
  return TOOL_CATEGORIES.map((category) => ({
    label: category.label,
    tools: category.tools.filter((name) => {
      if (selectedSet.has(name)) {
        return false
      }
      if (!q) {
        return true
      }
      return (
        name.toLowerCase().includes(q) ||
        (TOOL_DESCRIPTIONS[name]?.toLowerCase().includes(q) ?? false)
      )
    }),
  })).filter((category) => category.tools.length > 0)
})

const setSelected = (next: string[]): void => {
  emit('update:modelValue', next)
}

const addTool = (name: string): void => {
  if (selected.value.includes(name)) {
    return
  }
  setSelected([...selected.value, name])
  query.value = ''
  showSuggestions.value = false
}

const handleTagsUpdate = (value: unknown): void => {
  if (!Array.isArray(value)) {
    return
  }
  const next = value.filter((item): item is string => typeof item === 'string')
  // Only keep known tool names (ignore freeform TagsInput commits).
  const allowed = next.filter((name) => AVAILABLE_TOOLS.includes(name))
  setSelected(allowed)
}

const handleInputKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Enter') {
    event.preventDefault()
    const q = query.value.trim()
    if (!q) {
      return
    }
    const exact = AVAILABLE_TOOLS.find((name) => name.toLowerCase() === q.toLowerCase())
    if (exact && !selected.value.includes(exact)) {
      addTool(exact)
      return
    }
    const first = filteredGroups.value[0]?.tools[0]
    if (first) {
      addTool(first)
    }
    return
  }
  if (event.key === 'Escape') {
    showSuggestions.value = false
  }
}

const handleBlur = (): void => {
  showSuggestions.value = false
}

const handleQueryUpdate = (value: string | number): void => {
  query.value = String(value ?? '')
  showSuggestions.value = true
}
</script>

<template>
  <div class="relative">
    <TagsInput
      :model-value="selected"
      class="w-full min-h-9"
      @update:model-value="handleTagsUpdate"
    >
      <TagsInputItem v-for="item in selected" :key="item" :value="item">
        <TagsInputItemText />
        <TagsInputItemDelete />
      </TagsInputItem>
      <TagsInputInput
        :model-value="query"
        placeholder="Search tools..."
        @update:model-value="handleQueryUpdate"
        @focus="showSuggestions = true"
        @blur="handleBlur"
        @keydown="handleInputKeydown"
        @keydown.enter.prevent
      />
    </TagsInput>
    <ul
      v-if="showSuggestions && filteredGroups.length > 0"
      class="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
      @mousedown.prevent
    >
      <template v-for="group in filteredGroups" :key="group.label">
        <li class="px-2 py-1 text-xs font-medium text-muted-foreground">
          {{ group.label }}
        </li>
        <li
          v-for="name in group.tools"
          :key="name"
          class="cursor-pointer rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground"
          @mousedown.prevent="addTool(name)"
        >
          <div class="font-medium">{{ name }}</div>
          <div class="text-xs text-muted-foreground">
            {{ TOOL_DESCRIPTIONS[name] }}
          </div>
        </li>
      </template>
    </ul>
  </div>
</template>
