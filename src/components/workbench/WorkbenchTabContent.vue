<script setup lang="ts">
import { computed } from 'vue'
import WorkbenchTabsEditorTab from '@/components/workbench/tabs/EditorTab.vue'
import WorkbenchTabsTerminalTab from '@/components/workbench/tabs/TerminalTab.vue'
import WorkbenchTabsPlanTab from '@/components/workbench/tabs/PlanTab.vue'
import WorkbenchTabsAgentShellTab from '@/components/workbench/tabs/AgentShellTab.vue'
import useWorkbenchStore from '@/composables/use-workbench-store'
import type { WorkbenchTabType } from '@/types/workbench/workbench-tab'

const workbench = useWorkbenchStore()

const tabComponentMap: Record<WorkbenchTabType, object> = {
  editor: WorkbenchTabsEditorTab,
  terminal: WorkbenchTabsTerminalTab,
  plan: WorkbenchTabsPlanTab,
  'agent-shell': WorkbenchTabsAgentShellTab,
}

const activeTabId = computed(() => workbench.activeTabId.value)
</script>

<template>
  <div class="relative h-full min-h-0 overflow-hidden">
    <template v-for="tab in workbench.tabs.value" :key="tab.id">
      <div
        v-show="tab.id === activeTabId"
        class="absolute inset-0 min-h-0 overflow-hidden bg-sidebar"
      >
        <component :is="tabComponentMap[tab.type]" :tab="tab" />
      </div>
    </template>
  </div>
</template>
