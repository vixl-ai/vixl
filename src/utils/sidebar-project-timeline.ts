import type { FleetSidebarChat } from '@/types/fleet/fleet-sidebar-chat'
import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'
import { sidebarChatSortKey } from '@/utils/sidebar-chat-sort-key'

export type SidebarProjectTimelineItem =
  | { kind: 'chat'; chat: FleetSidebarChat }
  | { kind: 'worktree'; project: FleetSidebarProject }

const ALL_DIGITS = /^\d+$/

const instantMs = (value?: string): number | null => {
  if (!value) {
    return null
  }
  if (ALL_DIGITS.test(value)) {
    const seconds = Number(value)
    if (!Number.isFinite(seconds)) {
      return null
    }
    return seconds * 1000
  }
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) {
    return null
  }
  return parsed
}

const isNewer = (left?: string, right?: string): boolean => {
  const leftMs = instantMs(left)
  if (leftMs === null) {
    return false
  }
  const rightMs = instantMs(right)
  if (rightMs === null) {
    return true
  }
  return leftMs > rightMs
}

const sortWorktreesNewestFirst = (
  worktrees: readonly FleetSidebarProject[],
): FleetSidebarProject[] =>
  worktrees.slice().sort((left, right) => {
    if (isNewer(left.activityAt, right.activityAt)) {
      return -1
    }
    if (isNewer(right.activityAt, left.activityAt)) {
      return 1
    }
    return 0
  })

export default (
  chats: readonly FleetSidebarChat[],
  worktrees: readonly FleetSidebarProject[],
): SidebarProjectTimelineItem[] => {
  const items: SidebarProjectTimelineItem[] = []
  const pinned: FleetSidebarChat[] = []
  const unpinned: FleetSidebarChat[] = []

  for (const chat of chats) {
    if (chat.pinned === true) {
      pinned.push(chat)
    } else {
      unpinned.push(chat)
    }
  }

  for (const chat of pinned) {
    items.push({ kind: 'chat', chat })
  }

  unpinned.sort((left, right) => {
    if (isNewer(sidebarChatSortKey(left), sidebarChatSortKey(right))) {
      return -1
    }
    if (isNewer(sidebarChatSortKey(right), sidebarChatSortKey(left))) {
      return 1
    }
    return 0
  })

  const pending = sortWorktreesNewestFirst(worktrees)
  let worktreeIndex = 0

  for (const chat of unpinned) {
    while (
      worktreeIndex < pending.length &&
      isNewer(pending[worktreeIndex]?.activityAt, sidebarChatSortKey(chat))
    ) {
      items.push({ kind: 'worktree', project: pending[worktreeIndex]! })
      worktreeIndex += 1
    }
    items.push({ kind: 'chat', chat })
  }

  while (worktreeIndex < pending.length) {
    items.push({ kind: 'worktree', project: pending[worktreeIndex]! })
    worktreeIndex += 1
  }

  return items
}
