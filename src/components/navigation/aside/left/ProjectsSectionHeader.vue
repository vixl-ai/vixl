<script setup lang="ts">
import {
  ChevronsDownUp,
  Filter,
  FolderPlus,
  Search,
  Server,
} from '@lucide/vue'
import { toast } from 'vue-sonner'
import { Button } from '@/components/shadcn/ui/button'
import { SidebarGroupLabel } from '@/components/shadcn/ui/sidebar'
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
import useAddProject from '@/composables/use-add-project'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import useProjectsSection from '@/composables/use-projects-section'

const { addingProject, addProjectFromPicker, addSshProject } = useAddProject()
const { runningOnly, toggleRunningFilter, openSearch } = useProjectsSection()
const { expansionMode, toggleCollapseAll } = useProjectsExpansion()

const handleSearchClick = async (): Promise<void> => {
  try {
    await openSearch()
  } catch (error) {
    toast.error('Could not open search', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
</script>

<template>
  <div class="flex h-8 items-center justify-between gap-1 px-0">
    <SidebarGroupLabel class="h-auto px-0">
      Chats
    </SidebarGroupLabel>
    <div class="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="size-6"
            aria-label="Search projects and chats"
            @click="handleSearchClick"
          >
            <Search class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Search projects and chats</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="size-6"
            :class="runningOnly ? 'bg-accent text-accent-foreground' : ''"
            aria-label="Filter by running status"
            @click="toggleRunningFilter"
          >
            <Filter class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Filter by running status</TooltipContent>
      </Tooltip>
      <Tooltip :disable-closing-trigger="true">
        <TooltipTrigger as-child>
          <span class="inline-flex shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger as-child>
                <Button
                  variant="ghost"
                  size="icon"
                  class="size-6"
                  :disabled="addingProject"
                  aria-label="Add project"
                >
                  <FolderPlus class="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" class="w-44">
                <DropdownMenuItem @select="addProjectFromPicker">
                  <FolderPlus />
                  Add folder
                </DropdownMenuItem>
                <DropdownMenuItem @select="addSshProject">
                  <Server />
                  Add SSH
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </TooltipTrigger>
        <TooltipContent>Add project</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="size-6"
            :aria-label="expansionMode === 'all-collapsed' ? 'Expand all projects' : 'Collapse all projects'"
            @click="toggleCollapseAll"
          >
            <ChevronsDownUp class="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {{ expansionMode === 'all-collapsed' ? 'Expand all projects' : 'Collapse all projects' }}
        </TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
