import type { PlanPayload } from '@/types/workbench/workbench-tab'
import { findTab, updateTab } from './helpers'

export const rekeyPlanTab = (projectId: string, planId: string): void => {
  const existing = findTab(
    (tab) => tab.type === 'plan' && (tab.payload as PlanPayload).planId === planId,
  )
  if (!existing || existing.projectId === projectId) {
    return
  }
  updateTab(existing.id, { projectId })
}
