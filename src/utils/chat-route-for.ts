import { HOME_CHAT_SLUG, isHomeChatSlug } from '@/constants/home-chat'
import { readFleetGroups } from '@/utils/fleet-group-reader'
import { isGroupSlug } from '@/utils/primary-project-for-slug'

export default (
  projectSlug: string,
  chatId: string,
  subagentId?: string,
): string => {
  const base =
    isHomeChatSlug(projectSlug) || projectSlug === HOME_CHAT_SLUG
      ? `/chat/${chatId}`
      : isGroupSlug(projectSlug, readFleetGroups())
        ? `/group/${projectSlug}/chat/${chatId}`
        : `/project/${projectSlug}/chat/${chatId}`
  if (!subagentId) {
    return base
  }
  return `${base}/subagent/${subagentId}`
}
