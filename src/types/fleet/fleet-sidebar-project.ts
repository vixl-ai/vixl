import type { WorktreeLink } from './fleet-project'
import type { FleetSidebarChat } from './fleet-sidebar-chat'

export interface FleetSidebarProject {
  slug: string
  displayName: string
  kind?: 'project' | 'group'
  isActiveProject?: boolean
  defaultExpanded?: boolean
  chats: FleetSidebarChat[]
  hiddenChatCount?: number
  hiddenChats?: FleetSidebarChat[]
  id?: string
  rootPath?: string
  worktree?: WorktreeLink
  worktrees?: FleetSidebarProject[]
  activityAt?: string
}
