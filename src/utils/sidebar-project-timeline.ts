import type { FleetSidebarChat } from '@/types/fleet/fleet-sidebar-chat'
import type { FleetSidebarProject } from '@/types/fleet/fleet-sidebar-project'

export type SidebarProjectTimelineItem =
  | { kind: 'chat'; chat: FleetSidebarChat }
  | { kind: 'worktree'; project: FleetSidebarProject }

const isNewer = (left?: string, right?: string): boolean => {
  if (!left) {
    return false
  }
  if (!right) {
    return true
  }
  return left > right
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

  const pending = sortWorktreesNewestFirst(worktrees)
  let worktreeIndex = 0

  for (const chat of unpinned) {
    while (
      worktreeIndex < pending.length &&
      isNewer(pending[worktreeIndex]?.activityAt, chat.updatedAt)
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
