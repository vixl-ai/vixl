<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import { GitBranch, Trash2 } from '@lucide/vue'
import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/shadcn/ui/alert-dialog'
import { Button } from '@/components/shadcn/ui/button'
import { Checkbox } from '@/components/shadcn/ui/checkbox'
import { Label } from '@/components/shadcn/ui/label'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/shadcn/ui/context-menu'
import {
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
} from '@/components/shadcn/ui/sidebar'
import NavigationAsideLeftChatListItem from '@/components/navigation/aside/left/ChatListItem.vue'
import FileTreeGitLetter from '@/components/workbench/FileTreeGitLetter.vue'
import {
  confirmRemoveWorktree,
  loadWorktreeRemovePreview,
  type WorktreeRemovePreview,
} from '@/composables/remove-fleet-worktree'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import useGitStatus from '@/composables/use-git-status'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import { rollupDecoration } from '@/utils/git-file-decoration'
import projectRouteFor from '@/utils/project-route-for'

const props = defineProps<{
  project: FleetSidebarProject
  parentRootPath: string
}>()

const route = useRoute()
const router = useRouter()
const expansion = useProjectsExpansion()
const projectRoot = computed(() => props.project.rootPath ?? null)
const git = useGitStatus(projectRoot)
const decoration = computed(() => rollupDecoration(git.entries.value))
const branchLabel = computed(
  () => props.project.worktree?.branch ?? props.project.displayName,
)
const manualOpen = ref<boolean | null>(null)
const removeOpen = ref(false)
const removing = ref(false)
const loadingPreview = ref(false)
const forceRemove = ref(false)
const preview = ref<WorktreeRemovePreview | null>(null)

const worktreeOpen = computed({
  get: (): boolean =>
    expansion.resolveOpen(props.project.defaultExpanded ?? false, manualOpen.value),
  set: (open: boolean) => {
    manualOpen.value = open
    expansion.onProjectOpenChange()
  },
})

watch(
  () => props.project.defaultExpanded,
  () => {
    manualOpen.value = null
  },
)

watch(
  () => expansion.expansionMode.value,
  () => {
    manualOpen.value = null
  },
)

const handleOpenProject = async (): Promise<void> => {
  try {
    await router.push(projectRouteFor(props.project.slug))
  } catch (error) {
    toast.error('Could not open project', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const openRemoveDialog = async (): Promise<void> => {
  if (loadingPreview.value || !props.project.rootPath || !props.project.id) {
    return
  }

  loadingPreview.value = true
  try {
    preview.value = await loadWorktreeRemovePreview({
      slug: props.project.slug,
      rootPath: props.project.rootPath,
      branch: branchLabel.value,
    })
    forceRemove.value = preview.value.dirty
    removeOpen.value = true
  } catch (error) {
    toast.error('Could not load worktree details', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    loadingPreview.value = false
  }
}

const handleConfirmRemove = async (): Promise<void> => {
  if (removing.value || !props.project.id || !props.project.rootPath) {
    return
  }

  removing.value = true
  try {
    const force = forceRemove.value || Boolean(preview.value?.dirty)
    const result = await confirmRemoveWorktree({
      projectId: props.project.id,
      slug: props.project.slug,
      parentRoot: props.parentRootPath,
      worktreeRoot: props.project.rootPath,
      force,
    })
    if (!result.ok) {
      toast.error(
        result.reason === 'running' ? 'Cannot remove worktree' : 'Could not remove worktree',
        { description: result.message },
      )
      return
    }

    await refreshFleetSidebar()
    removeOpen.value = false
    if (route.params.slug === props.project.slug) {
      await router.push('/')
    }
    toast.success(`Removed worktree ${branchLabel.value}`)
  } catch (error) {
    toast.error('Could not remove worktree', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <Collapsible
    v-model:open="worktreeOpen"
    as-child
    class="group/worktree"
  >
    <SidebarMenuSubItem>
      <ContextMenu>
        <ContextMenuTrigger as-child>
          <CollapsibleTrigger as-child>
            <SidebarMenuButton
              size="sm"
              :tooltip="branchLabel"
              :is-active="project.isActiveProject"
              @click="handleOpenProject"
            >
              <GitBranch class="size-4 shrink-0" />
              <span class="min-w-0 flex-1 truncate">{{ branchLabel }}</span>
              <FileTreeGitLetter
                v-if="decoration"
                :status="decoration"
              />
            </SidebarMenuButton>
          </CollapsibleTrigger>
        </ContextMenuTrigger>
        <ContextMenuContent class="w-52">
          <ContextMenuItem
            variant="destructive"
            :disabled="loadingPreview || removing"
            @select="openRemoveDialog"
          >
            <Trash2 />
            Remove worktree
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <CollapsibleContent
        class="overflow-hidden data-[state=closed]:animate-sidebar-collapsible-up data-[state=open]:animate-sidebar-collapsible-down"
      >
        <SidebarMenuSub class="mx-0 gap-0.5">
          <SidebarMenuSubItem
            v-for="chat in project.chats"
            :key="chat.id"
          >
            <NavigationAsideLeftChatListItem
              :chat="chat"
              :project-slug="project.slug"
            />
          </SidebarMenuSubItem>
        </SidebarMenuSub>
      </CollapsibleContent>
    </SidebarMenuSubItem>
  </Collapsible>

  <AlertDialog v-model:open="removeOpen">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Remove worktree {{ branchLabel }}?</AlertDialogTitle>
        <AlertDialogDescription>
          Branch: {{ preview?.branch ?? branchLabel }}. Dirty:
          {{ preview?.dirtyLabel ?? 'unknown' }}. Chats:
          {{ preview?.chatCount ?? 0 }}.
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div class="flex items-center gap-2">
        <Checkbox
          :id="`force-remove-worktree-${project.slug}`"
          v-model="forceRemove"
        />
        <Label
          :for="`force-remove-worktree-${project.slug}`"
          class="text-sm font-normal"
        >
          Force remove
        </Label>
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="removing">Cancel</AlertDialogCancel>
        <Button
          variant="destructive"
          :disabled="removing"
          @click="handleConfirmRemove"
        >
          Remove
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
