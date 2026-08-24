export type BrowserBookmark = {
  url: string
  title: string | null
  createdAt: string
}

const storageKey = (workspaceId: string): string =>
  `vixl:browser:bookmarks:${workspaceId}`

const listeners = new Map<string, Set<() => void>>()

const readBookmarks = (workspaceId: string): BrowserBookmark[] => {
  try {
    const raw = localStorage.getItem(storageKey(workspaceId))
    if (!raw) {
      return []
    }
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }
    return parsed.filter((item): item is BrowserBookmark => {
      if (!item || typeof item !== 'object') {
        return false
      }
      const record = item as Record<string, unknown>
      return (
        typeof record.url === 'string' &&
        record.url.length > 0 &&
        (record.title === null || typeof record.title === 'string') &&
        typeof record.createdAt === 'string'
      )
    })
  } catch {
    return []
  }
}

const writeBookmarks = (
  workspaceId: string,
  bookmarks: BrowserBookmark[],
): void => {
  localStorage.setItem(storageKey(workspaceId), JSON.stringify(bookmarks))
  emit(workspaceId)
}

const emit = (workspaceId: string): void => {
  const set = listeners.get(workspaceId)
  if (!set) {
    return
  }
  for (const cb of set) {
    cb()
  }
}

const listBookmarks = (workspaceId: string): BrowserBookmark[] =>
  readBookmarks(workspaceId)

const isBookmarked = (workspaceId: string, url: string): boolean => {
  const trimmed = url.trim()
  if (!trimmed) {
    return false
  }
  return readBookmarks(workspaceId).some((item) => item.url === trimmed)
}

const addBookmark = (
  workspaceId: string,
  input: { url: string; title: string | null },
): void => {
  const url = input.url.trim()
  if (!url) {
    return
  }
  const existing = readBookmarks(workspaceId)
  if (existing.some((item) => item.url === url)) {
    return
  }
  writeBookmarks(workspaceId, [
    ...existing,
    {
      url,
      title: input.title,
      createdAt: new Date().toISOString(),
    },
  ])
}

const removeBookmark = (workspaceId: string, url: string): void => {
  const trimmed = url.trim()
  if (!trimmed) {
    return
  }
  const next = readBookmarks(workspaceId).filter((item) => item.url !== trimmed)
  writeBookmarks(workspaceId, next)
}

const subscribeBookmarks = (
  workspaceId: string,
  cb: () => void,
): (() => void) => {
  let set = listeners.get(workspaceId)
  if (!set) {
    set = new Set()
    listeners.set(workspaceId, set)
  }
  set.add(cb)

  const onStorage = (event: StorageEvent): void => {
    if (event.key === storageKey(workspaceId)) {
      cb()
    }
  }
  window.addEventListener('storage', onStorage)

  return () => {
    set?.delete(cb)
    if (set && set.size === 0) {
      listeners.delete(workspaceId)
    }
    window.removeEventListener('storage', onStorage)
  }
}

const browserBookmarks = {
  listBookmarks,
  isBookmarked,
  addBookmark,
  removeBookmark,
  subscribeBookmarks,
}

export default browserBookmarks
