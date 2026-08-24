import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleDotIcon,
  CircleIcon,
  XCircleIcon,
} from '@lucide/vue'
import type { PlanTodoItem } from '@/types/plans/plan-document'

export default (status: PlanTodoItem['status']) => {
  if (status === 'completed') {
    return CheckCircle2Icon
  }
  if (status === 'in_progress') {
    return CircleDotIcon
  }
  if (status === 'cancelled') {
    return XCircleIcon
  }
  if (status === 'pending') {
    return CircleDashedIcon
  }
  return CircleIcon
}
