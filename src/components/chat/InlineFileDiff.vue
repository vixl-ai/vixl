<script setup lang="ts">
import { computed } from 'vue'
import type { FileDiff } from '@/types/harness/file-diff'
import countDiffLines from '@/utils/count-diff-lines'
import resolveFileDiffHunks from '@/utils/resolve-file-diff-hunks'
import {
  CommitFileAdditions,
  CommitFileDeletions,
} from '@/components/ai-elements/commit'

const props = withDefaults(
  defineProps<{
    diff: FileDiff
    showPath?: boolean
  }>(),
  {
    showPath: false,
  },
)

const hunks = computed(() => resolveFileDiffHunks(props.diff))
const counts = computed(() => countDiffLines(hunks.value))
</script>

<template>
  <div class="space-y-1">
    <div
      v-if="showPath"
      class="flex items-center gap-2 px-0.5 text-xs font-medium"
    >
      <span class="min-w-0 truncate">{{ diff.path }}</span>
      <span class="ml-auto flex shrink-0 items-center gap-1.5 tabular-nums">
        <CommitFileAdditions
          :count="counts.additions"
          class="inline-flex items-center gap-0.5 text-[11px]"
        />
        <CommitFileDeletions
          :count="counts.deletions"
          class="inline-flex items-center gap-0.5 text-[11px]"
        />
      </span>
    </div>
    <div class="overflow-hidden rounded-md border border-border/50 text-xs">
      <div class="max-h-64 overflow-auto p-2 font-mono">
        <div
          v-for="(hunk, hunkIndex) in hunks"
          :key="hunkIndex"
          class="space-y-0"
        >
          <div
            v-for="(line, lineIndex) in hunk.lines"
            :key="`${hunkIndex}-${lineIndex}`"
            class="px-1"
            :class="{
              'bg-green-500/10 text-green-700 dark:text-green-400': line.kind === 'add',
              'bg-red-500/10 text-red-700 dark:text-red-400': line.kind === 'remove',
            }"
          >
            <span v-if="line.kind === 'add'">+</span>
            <span v-else-if="line.kind === 'remove'">-</span>
            <span v-else>&nbsp;</span>
            {{ line.content }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
