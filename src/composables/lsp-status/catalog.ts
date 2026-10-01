import {
  isTauri,
  lspCatalog,
  lspEnsureServer,
  lspWorkspaceProfile,
} from '@/services/vixl/vixl-tauri'
import type { LspCatalogEntry } from '@/services/vixl/vixl-tauri'
import formatUnknownError from '@/utils/format-unknown-error'
import { catalogRevisionWins, deriveIsBusy } from './helpers'
import {
  installMessage,
  listenerState,
  prefetchBusy,
  servers,
  warming,
  warmState,
} from './state'
import { noteServerState } from './toasts'

const POLL_INTERVAL_MS = 5_000

let catalogRequest = 0
let pollTimer: ReturnType<typeof setInterval> | null = null
let pollInFlight = false

const desiredServersRunning = (ids: string[]): boolean =>
  ids.every((id) => servers.value.get(id)?.state.phase === 'running')

export const mergeCatalogEntries = (entries: LspCatalogEntry[]): void => {
  const next = new Map<string, LspCatalogEntry>()
  for (const entry of entries) {
    const stored = servers.value.get(entry.id)
    if (!stored) {
      next.set(entry.id, entry)
      continue
    }
    const replace = catalogRevisionWins(stored.state.revision, entry.state.revision)
    const state = replace ? entry.state : stored.state
    next.set(entry.id, { ...entry, state })
    if (replace) {
      noteServerState(state, entry.label)
    }
  }
  for (const [id, stored] of servers.value) {
    if (!next.has(id) && stored.state.revision > 0) {
      next.set(id, stored)
    }
  }
  servers.value = next
}

export const invalidateCatalogRefresh = (): void => {
  catalogRequest += 1
}

export const refreshCatalog = async (): Promise<void> => {
  if (!isTauri()) {
    return
  }
  const request = ++catalogRequest
  try {
    const entries = await lspCatalog()
    if (request !== catalogRequest) {
      return
    }
    mergeCatalogEntries(entries)
  } catch (error) {
    if (request !== catalogRequest) {
      return
    }
    installMessage.value = formatUnknownError(error)
  }
  if (request !== catalogRequest) {
    return
  }
  syncLspStatePoll()
}

export const stopLspStatePoll = (): void => {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  pollInFlight = false
}

export const syncLspStatePoll = (): void => {
  const shouldPoll =
    listenerState.bound && deriveIsBusy(prefetchBusy.value, servers.value.values())
  if (!shouldPoll) {
    stopLspStatePoll()
    return
  }
  if (pollTimer !== null) {
    return
  }
  pollTimer = setInterval(() => {
    if (pollInFlight) {
      return
    }
    pollInFlight = true
    void refreshCatalog().finally(() => {
      pollInFlight = false
    })
  }, POLL_INTERVAL_MS)
}

export const warmDefaults = async (root: string, force = false): Promise<void> => {
  if (!isTauri() || (warming.value && !force)) {
    return
  }

  let ids: string[] = []
  let extensions: string[] = []
  try {
    const profile = await lspWorkspaceProfile(root)
    ids = profile.warm
    extensions = profile.warmExtensions
  } catch (error) {
    installMessage.value = formatUnknownError(error)
  }
  if (ids.length === 0 || extensions.length === 0) {
    warmState.lastWarmedRoot = root
    return
  }
  if (!force && warmState.lastWarmedRoot === root && desiredServersRunning(ids)) {
    return
  }

  warming.value = true
  try {
    await Promise.allSettled(extensions.map((ext) => lspEnsureServer(ext, root)))
    warmState.lastWarmedRoot = root
  } finally {
    warming.value = false
    await refreshCatalog()
  }
}
