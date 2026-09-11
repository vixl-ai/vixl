import { toast } from 'vue-sonner'
import formatUnknownError from '@/utils/format-unknown-error'
import { makeHarnessKey } from './helpers'

type CachedHarness = {
  markDisposed: () => void
  dispose: () => Promise<void>
}

const harnessCache = new Map<string, CachedHarness>()

export const getCachedAgentHarness = <T extends CachedHarness>(
  projectSlug: string,
  chatId: string,
): T | undefined =>
  harnessCache.get(makeHarnessKey(projectSlug, chatId)) as T | undefined

export const setCachedAgentHarness = <T extends CachedHarness>(
  projectSlug: string,
  chatId: string,
  harness: T,
): void => {
  harnessCache.set(makeHarnessKey(projectSlug, chatId), harness)
}

export const rekeyAgentHarness = (
  fromProjectSlug: string,
  chatId: string,
  toProjectSlug: string,
): void => {
  const fromKey = makeHarnessKey(fromProjectSlug, chatId)
  const toKey = makeHarnessKey(toProjectSlug, chatId)
  if (fromKey === toKey) {
    return
  }
  const existing = harnessCache.get(fromKey)
  if (!existing) {
    return
  }
  harnessCache.delete(fromKey)
  harnessCache.set(toKey, existing)
}

export const dropAgentHarness = (projectSlug: string, chatId: string): void => {
  const key = makeHarnessKey(projectSlug, chatId)
  const existing = harnessCache.get(key)
  harnessCache.delete(key)
  if (!existing) {
    return
  }
  existing.markDisposed()
  existing.dispose().catch((error: unknown) => {
    toast.error('Failed to stop chat session', {
      description: formatUnknownError(error),
    })
  })
}

export const resetAgentHarnessCacheForTests = (): void => {
  harnessCache.clear()
}
