<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Folder, FolderSymlink, Trash2 } from '@lucide/vue'
import { toast } from 'vue-sonner'
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
import { Button } from '@/components/shadcn/ui/button'
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/shadcn/ui/empty'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/shadcn/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import SettingsSectionScroll from '@/components/settings/SettingsSectionScroll.vue'
import useFleetRegistry from '@/composables/use-fleet-registry'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import useGraphs from '@/composables/use-graphs'
import useMcpServers from '@/composables/use-mcp-servers'
import { CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'
import type { GraphListItem } from '@/types/codegraph/graph-list-item'
import type { FleetProject } from '@/types/fleet/fleet-project'
import {
  fsMkdir,
  getUserVixlDir,
  openProjectAtPath,
  revealInFolder,
} from '@/services/vixl/vixl-tauri'
import formatBytes from '@/utils/format-bytes'
import projectRouteFor from '@/utils/project-route-for'

const router = useRouter()
const fleet = useFleetRegistry()
const mcp = useMcpServers()
const { data: graphRows, pending, remove } = useGraphs()

const graphToDelete = ref<GraphListItem | null>(null)
const deleting = ref(false)
const revealingRoot = ref(false)

const deleteOpen = computed({
  get: (): boolean => graphToDelete.value !== null,
  set: (open: boolean) => {
    if (!open) {
      graphToDelete.value = null
    }
  },
})

const mapOpenedProject = (record: {
  id: string
  name: string
  slug: string
  root_path: string
  last_opened: string
}): FleetProject => ({
  id: record.id,
  name: record.name,
  slug: record.slug,
  rootPath: record.root_path,
  lastOpened: record.last_opened,
})

const revealGraphsFolder = async (): Promise<void> => {
  revealingRoot.value = true
  try {
    const userDir = await getUserVixlDir()
    try {
      await fsMkdir({ projectRoot: userDir, path: 'graphs' })
    } catch (mkdirError) {
      toast.error('Failed to create graphs folder', {
        description:
          mkdirError instanceof Error ? mkdirError.message : 'Unknown error',
      })
    }
    await revealInFolder(`${userDir}/graphs`)
  } catch (error) {
    toast.error('Failed to reveal folder', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  } finally {
    revealingRoot.value = false
  }
}

const revealGraphStore = async (graph: GraphListItem): Promise<void> => {
  try {
    await revealInFolder(graph.storeDir)
  } catch (error) {
    toast.error('Failed to reveal folder', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const openGraphProject = async (graph: GraphListItem): Promise<void> => {
  if (graph.missing || !graph.projectRoot) {
    toast.error('Cannot open project', {
      description: 'The project folder is missing.',
    })
    return
  }

  try {
    const opened = await openProjectAtPath(graph.projectRoot)
    const project = mapOpenedProject(opened)
    await fleet.refresh()
    await refreshFleetSidebar()
    await router.push(projectRouteFor(project.slug, 'codegraph'))
  } catch (error) {
    toast.error('Failed to open project', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleConfirmDelete = async (): Promise<void> => {
  const graph = graphToDelete.value
  if (!graph) {
    return
  }

  deleting.value = true
  try {
    const activeRoot = fleet.activeProject.value?.rootPath
    if (activeRoot && graph.projectRoot === activeRoot) {
      try {
        await mcp.stopServer(CODEGRAPH_SERVER_ID, { quiet: true })
      } catch (error) {
        toast.error('Failed to stop graph', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
    const deleted = await remove(graph.id)
    if (deleted) {
      graphToDelete.value = null
    }
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <SettingsSectionScroll title="Graphs">
    <template #actions>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            aria-label="Open in folder"
            :disabled="revealingRoot"
            @click="revealGraphsFolder"
          >
            <FolderSymlink class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open in folder</TooltipContent>
      </Tooltip>
    </template>

    <Empty
      v-if="!pending && graphRows.length === 0"
      class="min-h-0 flex-1 border border-border/60"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Folder />
        </EmptyMedia>
        <EmptyTitle>No graphs yet</EmptyTitle>
      </EmptyHeader>
    </Empty>

    <div
      v-else
      class="min-h-0 flex-1 overflow-auto rounded-lg border border-border/40"
    >
      <Table>
        <TableHeader>
          <TableRow class="hover:bg-transparent">
            <TableHead class="h-9 px-3 text-xs">Name</TableHead>
            <TableHead class="h-9 px-3 text-xs">Storage size</TableHead>
            <TableHead class="h-9 w-28 px-3 text-right text-xs">
              Actions
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow
            v-for="graph in graphRows"
            :key="graph.id"
            class="cursor-pointer hover:bg-muted/30"
            @click="openGraphProject(graph)"
          >
            <TableCell
              class="px-3 py-2.5 font-medium"
              :class="graph.missing ? 'text-muted-foreground' : undefined"
            >
              {{ graph.name }}
            </TableCell>
            <TableCell class="px-3 py-2.5">
              {{ formatBytes(graph.bytes) }}
            </TableCell>
            <TableCell class="px-3 py-2.5 text-right" @click.stop>
              <div class="inline-flex items-center justify-end gap-1">
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8"
                      :aria-label="`Reveal ${graph.name}`"
                      @click="revealGraphStore(graph)"
                    >
                      <FolderSymlink class="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Reveal in folder</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="ghost"
                      size="icon"
                      class="size-8 text-destructive hover:text-destructive"
                      :aria-label="`Delete ${graph.name}`"
                      @click="graphToDelete = graph"
                    >
                      <Trash2 class="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete</TooltipContent>
                </Tooltip>
              </div>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>

    <AlertDialog v-model:open="deleteOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete graph?</AlertDialogTitle>
          <AlertDialogDescription>
            This deletes the stored index for "{{ graphToDelete?.name }}". The
            project stays in the sidebar.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="deleting">Cancel</AlertDialogCancel>
          <AlertDialogAction
            class="bg-destructive text-white hover:bg-destructive/90"
            :disabled="deleting"
            @click.prevent="handleConfirmDelete"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </SettingsSectionScroll>
</template>
