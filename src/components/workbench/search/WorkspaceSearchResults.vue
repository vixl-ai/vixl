<script setup lang="ts">
import { ChevronDown, ChevronRight } from '@lucide/vue'
import { toast } from 'vue-sonner'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/shadcn/ui/collapsible'
import { ScrollArea } from '@/components/shadcn/ui/scroll-area'
import type { GrepMatch } from '@/services/vixl/vixl-tauri'
import type { SearchFileGroup } from '@/types/workbench/search-file-group'
import openAtLine from '@/utils/open-at-line'

type LinePart = {
  text: string
  hit: boolean
}

const props = defineProps<{
  projectId: string
  groups: SearchFileGroup[]
  pending: boolean
  replacing: boolean
  replaceExpanded: boolean
  summaryLabel: string
  hasQuery: boolean
  isGroupOpen: (path: string) => boolean
  setGroupOpen: (path: string, open: boolean) => void
}>()

const emit = defineEmits<{
  'replace-hit': [hit: GrepMatch]
  'replace-file': [path: string]
}>()

const fileName = (path: string): string => path.split('/').pop() ?? path

const fileDirectory = (path: string): string => {
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash <= 0) {
    return ''
  }
  return path.slice(0, lastSlash)
}

const hitKey = (hit: GrepMatch, index: number): string =>
  `${hit.path}:${hit.lineNumber}:${hit.startColumn ?? ''}:${hit.endColumn ?? ''}:${index}`

const lineParts = (hit: GrepMatch): LinePart[] => {
  const line = hit.line
  const start = hit.startColumn
  const end = hit.endColumn
  if (
    typeof start !== 'number'
    || typeof end !== 'number'
    || start < 1
    || end <= start
  ) {
    return [{ text: line, hit: false }]
  }
  const from = start - 1
  const to = end - 1
  return [
    { text: line.slice(0, from), hit: false },
    { text: line.slice(from, to), hit: true },
    { text: line.slice(to), hit: false },
  ].filter((part) => part.text.length > 0)
}

const handleOpenHit = async (hit: GrepMatch): Promise<void> => {
  try {
    await openAtLine(props.projectId, hit.path, hit.lineNumber)
  } catch (error) {
    toast.error('Failed to open match', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleReplaceHit = async (hit: GrepMatch): Promise<void> => {
  emit('replace-hit', hit)
}

const handleReplaceFile = async (path: string): Promise<void> => {
  emit('replace-file', path)
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <div
      v-if="hasQuery"
      class="shrink-0 border-b border-border/20 px-3 py-1.5 text-[11px] text-muted-foreground"
    >
      <span v-if="pending">Searching...</span>
      <span v-else>{{ summaryLabel }}</span>
    </div>

    <ScrollArea class="min-h-0 flex-1">
      <div class="px-1 py-1 font-sans text-[13px]">
        <p
          v-if="!hasQuery"
          class="px-2 py-3 text-xs text-muted-foreground"
        >
          Type a search query to find matches in the project.
        </p>
        <p
          v-else-if="!pending && groups.length === 0"
          class="px-2 py-3 text-xs text-muted-foreground"
        >
          No results found.
        </p>

        <Collapsible
          v-for="group in groups"
          :key="group.path"
          :open="isGroupOpen(group.path)"
          @update:open="setGroupOpen(group.path, $event)"
        >
          <div class="group flex w-full items-center gap-1 rounded px-1.5 py-1 hover:bg-muted/50">
            <CollapsibleTrigger as-child>
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1 text-left"
              >
                <ChevronDown
                  v-if="isGroupOpen(group.path)"
                  class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
                <ChevronRight
                  v-else
                  class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                />
                <span class="min-w-0 flex-1 truncate font-medium text-foreground">
                  {{ fileName(group.path) }}
                </span>
                <span
                  v-if="fileDirectory(group.path)"
                  class="max-w-[40%] shrink-0 truncate text-[11px] text-muted-foreground"
                >
                  {{ fileDirectory(group.path) }}
                </span>
                <span class="shrink-0 text-[11px] text-muted-foreground">
                  {{ group.hits.length }}
                </span>
              </button>
            </CollapsibleTrigger>
            <WorkspaceSearchFileReplace
              v-if="replaceExpanded"
              :path="group.path"
              :replacing="replacing"
              @replace="handleReplaceFile"
            />
          </div>
          <CollapsibleContent>
            <button
              v-for="(hit, index) in group.hits"
              :key="hitKey(hit, index)"
              type="button"
              class="group flex w-full items-start gap-2 rounded px-1.5 py-0.5 pl-6 text-left hover:bg-muted/50"
              @click="handleOpenHit(hit)"
            >
              <span class="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                {{ hit.lineNumber }}
              </span>
              <span class="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground">
                <template
                  v-for="(part, partIndex) in lineParts(hit)"
                  :key="`${hitKey(hit, index)}:${partIndex}`"
                >
                  <mark
                    v-if="part.hit"
                    class="rounded-sm bg-yellow-500/30 text-foreground"
                  >{{ part.text }}</mark>
                  <template v-else>{{ part.text }}</template>
                </template>
              </span>
              <WorkspaceSearchHitReplace
                v-if="replaceExpanded"
                :hit="hit"
                :replacing="replacing"
                @replace="handleReplaceHit"
              />
            </button>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </ScrollArea>
  </div>
</template>
