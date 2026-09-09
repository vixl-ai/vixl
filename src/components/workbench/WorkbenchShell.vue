<script setup lang="ts">
import { AppIcon } from '@/icons'
import { computed } from 'vue'
import WorkbenchTabContent from '@/components/workbench/WorkbenchTabContent.vue'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/shadcn/ui/empty'
import useWorkbenchStore from '@/composables/use-workbench-store'

const workbench = useWorkbenchStore()

const hasTabs = computed(() => workbench.tabs.value.length > 0)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col overflow-hidden" :class="hasTabs ? '' : 'bg-sidebar'">
    <Empty v-if="!hasTabs" class="flex-1 border-none">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <AppIcon name="panel-right" />
        </EmptyMedia>
        <EmptyTitle>No tabs open</EmptyTitle>
      </EmptyHeader>
    </Empty>
    <WorkbenchTabContent v-else class="min-h-0 flex-1" />
  </div>
</template>
