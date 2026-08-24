<script setup lang="ts">
import { ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { Search } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  CommandDialog,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/shadcn/ui/command'
import WorkbenchFileEntryIcon from '@/components/workbench/FileEntryIcon.vue'
import { workspaceGlob } from '@/services/vixl/vixl-tauri'

const FILE_SEARCH_LIMIT = 100
const SEARCH_DEBOUNCE_MS = 200

const props = defineProps<{
  open: boolean
  projectRoot: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  select: [path: string]
}>()

const query = ref('')
const files = ref<string[]>([])
const loading = ref(false)
const truncated = ref(false)
const searchGeneration = ref(0)

const fileName = (path: string): string => path.split('/').pop() ?? path

const fileDirectory = (path: string): string => {
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash <= 0) {
    return ''
  }
  return path.slice(0, lastSlash)
}

const escapeGlob = (value: string): string =>
  value.replace(/[\\*?[\]]/g, '\\$&')

const normalizeQuery = (value: string): string =>
  value.trim().replace(/\s+/g, '*')

const rankFiles = (paths: string[], rawQuery: string): string[] => {
  const needle = rawQuery.trim().toLowerCase()
  if (!needle) {
    return paths
  }

  return [...paths].sort((left, right) => {
    const leftName = fileName(left).toLowerCase()
    const rightName = fileName(right).toLowerCase()
    const leftNameMatch = leftName.includes(needle)
    const rightNameMatch = rightName.includes(needle)
    if (leftNameMatch !== rightNameMatch) {
      return leftNameMatch ? -1 : 1
    }
    const leftPath = left.toLowerCase()
    const rightPath = right.toLowerCase()
    const leftPathMatch = leftPath.includes(needle)
    const rightPathMatch = rightPath.includes(needle)
    if (leftPathMatch !== rightPathMatch) {
      return leftPathMatch ? -1 : 1
    }
    return left.localeCompare(right)
  })
}

const resetResults = (): void => {
  files.value = []
  truncated.value = false
  loading.value = false
}

const runSearch = async (rawQuery: string): Promise<void> => {
  const normalized = normalizeQuery(rawQuery)
  const root = props.projectRoot

  if (!normalized || !root) {
    resetResults()
    return
  }

  const generation = ++searchGeneration.value
  loading.value = true

  try {
    const result = await workspaceGlob(
      root,
      `*${escapeGlob(normalized)}*`,
      FILE_SEARCH_LIMIT,
    )
    if (generation !== searchGeneration.value) {
      return
    }
    files.value = rankFiles(
      result.files.map((entry) => entry.path),
      rawQuery,
    )
    truncated.value = result.truncated
  } catch (error) {
    if (generation !== searchGeneration.value) {
      return
    }
    resetResults()
    toast.error('Failed to search files', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    if (generation === searchGeneration.value) {
      loading.value = false
    }
  }
}

const debouncedSearch = useDebounceFn((rawQuery: string) => {
  runSearch(rawQuery)
}, SEARCH_DEBOUNCE_MS)

const handleOpenChange = (nextOpen: boolean): void => {
  emit('update:open', nextOpen)
  if (!nextOpen) {
    searchGeneration.value += 1
    query.value = ''
    resetResults()
  }
}

const handleSelect = (path: string): void => {
  emit('update:open', false)
  emit('select', path)
  searchGeneration.value += 1
  query.value = ''
  resetResults()
}

watch(query, (value) => {
  if (!value.trim()) {
    searchGeneration.value += 1
    resetResults()
    return
  }
  files.value = []
  truncated.value = false
  loading.value = true
  debouncedSearch(value)
})

watch(
  () => props.open,
  (isOpen) => {
    if (!isOpen) {
      searchGeneration.value += 1
      query.value = ''
      resetResults()
    }
  },
)
</script>

<template>
  <CommandDialog
    :open="open"
    title="Search files"
    description="Search and open a file in the project"
    @update:open="handleOpenChange"
  >
    <div
      data-slot="command-input-wrapper"
      class="flex h-9 items-center gap-2 border-b px-3"
    >
      <Search class="size-4 shrink-0 opacity-50" />
      <input
        v-model="query"
        data-slot="command-input"
        class="placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
        placeholder="Search project files…"
        autofocus
      >
    </div>
    <CommandList v-if="files.length > 0">
      <CommandGroup
        :heading="truncated ? `Files (first ${FILE_SEARCH_LIMIT})` : undefined"
      >
        <CommandItem
          v-for="path in files"
          :key="path"
          :value="path"
          class="[&_img]:pointer-events-none [&_img]:size-4 [&_img]:shrink-0"
          @select="handleSelect(path)"
        >
          <WorkbenchFileEntryIcon :name="fileName(path)" />
          <span class="truncate">{{ fileName(path) }}</span>
          <span
            v-if="fileDirectory(path)"
            class="ml-auto truncate text-xs text-muted-foreground"
          >
            {{ fileDirectory(path) }}
          </span>
        </CommandItem>
      </CommandGroup>
    </CommandList>
  </CommandDialog>
</template>
