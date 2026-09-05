<script setup lang="ts">
import { ExternalLink, FolderSymlink } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import type { ProjectFileEntry, VixlFilesKind } from '@/services/vixl/vixl-tauri'
import { revealInFolder } from '@/services/vixl/vixl-tauri'

defineProps<{
  file: ProjectFileEntry
  kind: VixlFilesKind
}>()

const emit = defineEmits<{
  (e: 'open', file: ProjectFileEntry): void
}>()
</script>

<template>
  <div
    class="flex items-center justify-between rounded-lg border border-border/50 px-4 py-2"
  >
    <div>
      <p class="font-medium">{{ file.description ?? file.name }}</p>
      <p
        v-if="kind === 'studio' && file.description && file.description !== file.name"
        class="text-xs text-muted-foreground"
      >
        {{ file.name }}
      </p>
    </div>
    <div class="flex items-center gap-0.5">
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            aria-label="Open in editor"
            @click="emit('open', file)"
          >
            <ExternalLink class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open in editor</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger as-child>
          <Button
            variant="ghost"
            size="icon"
            class="h-8 w-8"
            aria-label="Reveal in folder"
            @click="revealInFolder(file.path)"
          >
            <FolderSymlink class="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Reveal in folder</TooltipContent>
      </Tooltip>
    </div>
  </div>
</template>
