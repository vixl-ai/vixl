<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import { Input } from '@/components/shadcn/ui/input'
import WorkbenchFileTreeGitLetter from '@/components/workbench/FileTreeGitLetter.vue'
import useGitStatus from '@/composables/use-git-status'
import useWorkbenchStore from '@/composables/use-workbench-store'
import { cn } from '@/lib/utils'
import type { GitFileDecoration } from '@/types/git/git-file-decoration'
import type { GitStatusEntry } from '@/types/git/git-status-entry'
import type { WorkbenchTab } from '@/types/workbench/workbench-tab'
import {
  decorationFromEntry,
  decorationLabel,
  decorationNameClass,
} from '@/utils/git-file-decoration'

type ChangeRow = {
  entry: GitStatusEntry
  decoration: GitFileDecoration
}

const props = defineProps<{
  tab: WorkbenchTab
}>()

const workbench = useWorkbenchStore()
const query = ref('')

const projectRoot = computed(() => workbench.getProject(props.tab.projectId)?.rootPath ?? null)
const isActive = computed(() => workbench.activeTabId.value === props.tab.id)

const {
  entries,
  branch,
  pending,
  error,
  refresh,
} = useGitStatus(projectRoot)

const changeEntries = computed((): ChangeRow[] => {
  const rows: ChangeRow[] = []
  for (const entry of entries.value) {
    if (entry.isIgnored) {
      continue
    }
    const decoration = decorationFromEntry(entry)
    if (!decoration) {
      continue
    }
    rows.push({ entry, decoration })
  }
  return rows
})

const filteredEntries = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) {
    return changeEntries.value
  }
  return changeEntries.value.filter((row) =>
    row.entry.path.toLowerCase().includes(needle),
  )
})

const handleOpenDiff = async (path: string): Promise<void> => {
  try {
    await workbench.openDiff(props.tab.projectId, path)
  } catch (err) {
    toast.error('Failed to open diff', {
      description: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}

const refreshWhenActive = async (): Promise<void> => {
  if (!isActive.value) {
    return
  }
  try {
    await refresh()
  } catch (err) {
    toast.error('Failed to load changes', {
      description: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}

watch(
  isActive,
  (active) => {
    if (!active) {
      return
    }
    refreshWhenActive().catch((err) => {
      toast.error('Failed to load changes', {
        description: err instanceof Error ? err.message : 'Unknown error',
      })
    })
  },
  { immediate: true },
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background p-4 text-sm">
    <div class="mb-3 flex items-center justify-between gap-2">
      <div>
        <p class="text-xs font-medium uppercase tracking-wide text-muted-foreground">Local</p>
        <p class="font-medium">{{ branch ?? 'No branch' }}</p>
      </div>
    </div>

    <Input
      v-model="query"
      type="search"
      placeholder="Search changes…"
      class="mb-3 h-8"
      aria-label="Search changed files"
    />

    <div class="min-h-0 flex-1 overflow-y-auto">
      <p v-if="pending && changeEntries.length === 0" class="text-muted-foreground">
        Loading git status…
      </p>
      <p v-else-if="error" class="text-destructive">{{ error }}</p>
      <p v-else-if="changeEntries.length === 0" class="text-muted-foreground">
        No uncommitted changes
      </p>
      <p v-else-if="filteredEntries.length === 0" class="text-muted-foreground">
        No matching changes
      </p>

      <ul v-else class="space-y-1">
        <li
          v-for="row in filteredEntries"
          :key="row.entry.path"
          class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50"
          :title="decorationLabel(row.decoration)"
          @click="handleOpenDiff(row.entry.path)"
        >
          <WorkbenchFileTreeGitLetter :status="row.decoration" />
          <span
            :class="cn('min-w-0 flex-1 truncate', decorationNameClass(row.decoration))"
          >
            {{ row.entry.path }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
