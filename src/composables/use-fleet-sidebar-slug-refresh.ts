import type { ChatMeta } from '@/types/chat/chat-meta'

type SlugRefresh = {
  promise: Promise<void>
  again: boolean
}

// Coalescing window for per-slug chat list refreshes. Bursts of chat status
// events collapse into one list_chats call per window instead of one per event.
const COALESCE_MS = 50

const refreshes = new Map<string, SlugRefresh>()

/**
 * Builds a per-slug refresh function that dedupes concurrent callers.
 * Callers that join a running refresh request one more read, so changes made
 * after its last read are picked up before every caller's promise resolves.
 */
export default (
  fetchChats: (projectSlug: string) => Promise<ChatMeta[]>,
  applyChats: (projectSlug: string, chats: ChatMeta[]) => void,
) => {
  return async (projectSlug: string): Promise<void> => {
    const existing = refreshes.get(projectSlug)
    if (existing) {
      existing.again = true
      await existing.promise
      return
    }
    const entry: SlugRefresh = { promise: Promise.resolve(), again: false }
    const run = async (): Promise<void> => {
      try {
        do {
          entry.again = false
          await new Promise((resolve) => setTimeout(resolve, COALESCE_MS))
          applyChats(projectSlug, await fetchChats(projectSlug))
        } while (entry.again)
      } finally {
        refreshes.delete(projectSlug)
      }
    }
    entry.promise = run()
    refreshes.set(projectSlug, entry)
    await entry.promise
  }
}