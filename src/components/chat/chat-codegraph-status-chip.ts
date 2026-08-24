import { isHomeChatSlug } from '@/constants/home-chat'

export const shouldShowChatCodegraphStatusChip = ({
  routeName,
  routeSlug,
  activeProjectSlug,
}: {
  routeName: string | symbol | null | undefined
  routeSlug: string | null | undefined
  activeProjectSlug: string | null | undefined
}): boolean => {
  const standalone =
    routeName === 'home-chat' ||
    routeName === 'home-chat-subagent' ||
    isHomeChatSlug(String(routeSlug ?? ''))
  return !standalone && Boolean(activeProjectSlug)
}
