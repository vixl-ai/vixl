import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { toast } from 'vue-sonner'
import browserBookmarks, {
  type BrowserBookmark,
} from '@/services/browser/bookmarks'

const SHOW_BOOKMARK_BAR_KEY = 'vixl:browser:showBookmarkBar'

const readShowBookmarkBar = (): boolean => {
  try {
    return localStorage.getItem(SHOW_BOOKMARK_BAR_KEY) === 'true'
  } catch {
    return false
  }
}

export default (workspaceId: string, currentUrl: Ref<string>) => {
  const revision = ref(0)
  const showBookmarkBar = ref(readShowBookmarkBar())

  let unsubscribe: (() => void) | null = null

  onMounted(() => {
    unsubscribe = browserBookmarks.subscribeBookmarks(workspaceId, () => {
      revision.value += 1
    })
  })

  onBeforeUnmount(() => {
    unsubscribe?.()
    unsubscribe = null
  })

  const bookmarks = computed((): BrowserBookmark[] => {
    const tick = revision.value
    if (tick < 0) {
      return []
    }
    return browserBookmarks.listBookmarks(workspaceId)
  })

  const isCurrentBookmarked = computed((): boolean => {
    const tick = revision.value
    if (tick < 0) {
      return false
    }
    const url = currentUrl.value.trim()
    if (!url) {
      return false
    }
    return browserBookmarks.isBookmarked(workspaceId, url)
  })

  const toggleShowBookmarkBar = (): void => {
    showBookmarkBar.value = !showBookmarkBar.value
    try {
      localStorage.setItem(
        SHOW_BOOKMARK_BAR_KEY,
        showBookmarkBar.value ? 'true' : 'false',
      )
    } catch {
      // Ignore persistence failures; UI state still updates.
    }
  }

  const toggleCurrentBookmark = (title: string | null): void => {
    const url = currentUrl.value.trim()
    if (!url) {
      return
    }
    try {
      if (browserBookmarks.isBookmarked(workspaceId, url)) {
        browserBookmarks.removeBookmark(workspaceId, url)
        revision.value += 1
        toast.success('Removed bookmark')
        return
      }
      browserBookmarks.addBookmark(workspaceId, { url, title })
      revision.value += 1
      toast.success('Bookmarked')
    } catch (error) {
      toast.error('Failed to update bookmark', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const removeBookmarkUrl = (url: string): void => {
    try {
      browserBookmarks.removeBookmark(workspaceId, url)
      revision.value += 1
      toast.success('Removed bookmark')
    } catch (error) {
      toast.error('Failed to remove bookmark', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return {
    bookmarks,
    isCurrentBookmarked,
    showBookmarkBar,
    toggleShowBookmarkBar,
    toggleCurrentBookmark,
    removeBookmarkUrl,
  }
}
