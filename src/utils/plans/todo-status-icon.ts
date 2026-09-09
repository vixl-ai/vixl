import type { AppIconName } from '@/icons'
import type { PlanTodoItem } from '@/types/plans/plan-document'

/** Semantic icon name for a plan todo status (resolved via AppIcon). */
export default (status: PlanTodoItem['status']): AppIconName => {
  if (status === 'completed') {
    return 'circle-check-big'
  }
  if (status === 'in_progress') {
    return 'circle-dot'
  }
  if (status === 'cancelled') {
    return 'circle-x'
  }
  if (status === 'pending') {
    return 'circle-dashed'
  }
  return 'circle'
}
