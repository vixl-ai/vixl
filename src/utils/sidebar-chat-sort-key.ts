export type SidebarChatSortInputs = {
  lastUserMessageAt?: string
  createdAt?: string
  updatedAt?: string
}

export const sidebarChatSortKey = (
  chat: SidebarChatSortInputs,
): string | undefined =>
  chat.lastUserMessageAt ?? chat.createdAt ?? chat.updatedAt
