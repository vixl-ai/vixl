<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed, ref } from 'vue'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import useGitBranches from '@/composables/use-git-branches'

const git = useGitBranches()
const branchSearch = ref('')
const menuOpen = ref(false)

const filteredBranches = computed(() => {
  const query = branchSearch.value.trim().toLowerCase()
  if (!query) {
    return git.branches.value
  }
  return git.branches.value.filter((branch) => branch.toLowerCase().includes(query))
})

const handleOpenChange = async (open: boolean): Promise<void> => {
  menuOpen.value = open
  if (open) {
    branchSearch.value = ''
    await git.refresh()
  }
}

const handleBranchSelect = async (branch: string): Promise<void> => {
  menuOpen.value = false
  await git.checkoutBranch(branch)
}
</script>

<template>
  <DropdownMenu :open="menuOpen" @update:open="handleOpenChange">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 min-w-0 gap-1.5 px-2 text-xs text-muted-foreground"
        :disabled="git.pending.value || git.checkoutPending.value"
        :title="git.currentBranch.value ?? 'Git branch'"
        aria-label="Git branch"
      >
        <AppIcon name="git-branch" class="size-3.5 shrink-0" />
        <span class="max-w-24 min-w-0 truncate @max-[22rem]/composer:hidden">
          {{ git.currentBranch.value ?? 'Branch' }}
        </span>
        <AppIcon name="chevron-down" class="size-3 shrink-0 opacity-60" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" class="w-56 p-0">
      <div class="border-b border-border/50 p-2" @pointerdown.stop>
        <Input v-model="branchSearch" placeholder="Search branches…" class="h-8" @keydown.stop />
      </div>
      <div class="max-h-60 overflow-y-auto p-1">
        <DropdownMenuItem
          v-for="branch in filteredBranches"
          :key="branch"
          class="gap-2"
          @select="handleBranchSelect(branch)"
        >
          <AppIcon
            name="check"
            class="size-3.5 shrink-0"
            :class="branch === git.currentBranch.value ? 'opacity-100' : 'opacity-0'"
          />
          <span class="truncate">{{ branch }}</span>
        </DropdownMenuItem>
        <p
          v-if="!git.pending.value && filteredBranches.length === 0"
          class="px-2 py-4 text-center text-sm text-muted-foreground"
        >
          {{ branchSearch.trim() ? 'No branches match your search.' : 'No branches found.' }}
        </p>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
