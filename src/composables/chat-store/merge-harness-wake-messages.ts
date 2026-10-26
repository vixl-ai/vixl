import type { UIMessage } from 'ai'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import { clearActiveTurnState } from './helpers'
import { rebuildMessagesFromTimeline } from './message-parsing'
import type { ChatSession } from './types'

const metadataRecord = (message: UIMessage): Record<string, unknown> | null => {
  if (!message.metadata || typeof message.metadata !== 'object') {
    return null
  }
  return message.metadata as Record<string, unknown>
}

const messageCreatedAt = (message: UIMessage): string | undefined => {
  const createdAt = metadataRecord(message)?.createdAt
  return typeof createdAt === 'string' ? createdAt : undefined
}

const isHarnessWakeMessage = (message: UIMessage): boolean =>
  message.role === 'user' && metadataRecord(message)?.harnessWake === true

const previousIndex = (previous: UIMessage[], id: string): number =>
  previous.findIndex((message) => message.id === id)

const appearsBeforeInPrevious = (
  previous: UIMessage[],
  leftId: string,
  rightId: string,
): boolean => {
  const leftIndex = previousIndex(previous, leftId)
  const rightIndex = previousIndex(previous, rightId)
  return leftIndex >= 0 && rightIndex >= 0 && leftIndex < rightIndex
}

export const mergeHarnessWakeMessages = (
  rebuilt: UIMessage[],
  previous: UIMessage[],
  boundaryCreatedAt: string | undefined,
  _span: 'before' | 'through',
  boundaryMessageId?: string,
): UIMessage[] => {
  if (!boundaryCreatedAt) {
    return rebuilt
  }
  const kept = previous.filter((message) => {
    if (!isHarnessWakeMessage(message)) {
      return false
    }
    const createdAt = messageCreatedAt(message)
    if (!createdAt) {
      return false
    }
    if (createdAt < boundaryCreatedAt) {
      return true
    }
    if (createdAt > boundaryCreatedAt) {
      return false
    }
    if (!boundaryMessageId) {
      return false
    }
    return appearsBeforeInPrevious(previous, message.id, boundaryMessageId)
  })
  if (kept.length === 0) {
    return rebuilt
  }
  const orderedWakes = [...kept].sort((left, right) => {
    const leftAt = messageCreatedAt(left) ?? ''
    const rightAt = messageCreatedAt(right) ?? ''
    if (leftAt !== rightAt) {
      return leftAt < rightAt ? -1 : 1
    }
    return previousIndex(previous, left.id) - previousIndex(previous, right.id)
  })
  const merged = [...rebuilt]
  for (const wake of orderedWakes) {
    const wakeAt = messageCreatedAt(wake)
    if (!wakeAt) {
      continue
    }
    const wakePrev = previousIndex(previous, wake.id)
    const index = merged.findIndex((message) => {
      const createdAt = messageCreatedAt(message)
      if (typeof createdAt !== 'string') {
        return false
      }
      if (createdAt > wakeAt) {
        return true
      }
      if (createdAt < wakeAt) {
        return false
      }
      const messagePrev = previousIndex(previous, message.id)
      return wakePrev >= 0 && messagePrev >= 0 && wakePrev < messagePrev
    })
    if (index < 0) {
      merged.push(wake)
    } else {
      merged.splice(index, 0, wake)
    }
  }
  return merged
}

export const applyHarnessWakeTimelineTruncate = (
  session: ChatSession,
  nextTimeline: ChatTimelineItem[],
  boundaryIndex: number,
  span: 'before' | 'through',
): void => {
  const item = session.timeline.value[boundaryIndex]
  const boundaryCreatedAt =
    item?.type === 'user' ? messageCreatedAt(item.message) : undefined
  const boundaryMessageId =
    item?.type === 'user' ? item.message.id : undefined
  const previousMessages = session.messages.value
  session.timeline.value = nextTimeline
  session.messages.value = mergeHarnessWakeMessages(
    rebuildMessagesFromTimeline(nextTimeline),
    previousMessages,
    boundaryCreatedAt,
    span,
    boundaryMessageId,
  )
  clearActiveTurnState(session)
}
