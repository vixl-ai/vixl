import serializeTimelineForBudget from '@/services/context/serialize-timeline-for-budget'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'

export default (timeline: ChatTimelineItem[]): string =>
  serializeTimelineForBudget({ timeline })
