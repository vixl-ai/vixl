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
}
