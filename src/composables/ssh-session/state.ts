import { ref } from 'vue'
import type { UnlistenFn } from '@tauri-apps/api/event'
import type { SshBannerEvent, SshConfirmEvent, SshPreview, SshSecretEvent, SshSessionStatus } from '@/services/vixl/vixl-tauri/ssh'
import { sshSessionKey } from '@/utils/ssh-project-root'
import type { SshProjectRoot } from '@/utils/ssh-project-root'

export type SshConnectPhase = 'form' | 'connecting' | 'error' | 'pick-folder'
export type SshConnectMode = 'add' | 'reconnect'

export type FolderEntry = { name: string; path: string; kind: string }

export const sessions = ref<SshSessionStatus[]>([])
export const aliases = ref<string[]>([])
export const connectOpen = ref(false)
export const connectMode = ref<SshConnectMode>('add')
export const connectPhase = ref<SshConnectPhase>('form')
export const connectAttempt = ref(0)
export const connectHost = ref('')
export const connectUser = ref('')
export const connectPort = ref('22')
export const connectIdentity = ref('')
export const connectPasswordOnly = ref(false)
export const connectStatus = ref('')
export const connectErrorTitle = ref('')
export const connectErrorBody = ref('')
export const connectElapsed = ref(0)
export const preview = ref<SshPreview | null>(null)
export const activePreview = ref<SshPreview | null>(null)
export const banner = ref<SshBannerEvent | null>(null)
export const confirmEvent = ref<SshConfirmEvent | null>(null)
export const secretEvent = ref<SshSecretEvent | null>(null)
export const secretValue = ref('')
export const showSecret = ref(false)
export const saveSecret = ref(false)
export const usedSavedSecret = ref(false)
export const secretAttempt = ref(0)
export const changedKey = ref<{
  hostname: string
  port: number
  title: string
  body: string
  canRemove: boolean
} | null>(null)
export const removeKeyOpen = ref(false)
export const disconnectConfirm = ref<{
  user: string
  hostname: string
  port: number
  sharedCount: number
} | null>(null)
export const folderHome = ref('')
export const folderCurrent = ref('')
export const folderRelative = ref('.')
export const folderEntries = ref<FolderEntry[]>([])
export const folderSelected = ref<string[]>([])
export const folderListing = ref(false)
export const folderError = ref('')
export const portForwardOpen = ref(false)
export const portForwardRemoteHost = ref('127.0.0.1')
export const portForwardRemotePort = ref('8080')
export const portForwardLocalPort = ref('8080')
export const portForwardBind = ref('127.0.0.1')
export const portForwardTarget = ref<SshProjectRoot | null>(null)
export const portForwardError = ref('')
export const trustOpen = ref(false)
export const trustRoot = ref<string | null>(null)
export const secretFocusEl = ref<HTMLElement | null>(null)
export const toastedDeath = new Set<string>()

export let elapsedTimer: ReturnType<typeof setInterval> | null = null
export let listenersBound = false
export let unlisteners: UnlistenFn[] = []

export const setListeners = (fns: UnlistenFn[]): void => {
  listenersBound = true
  unlisteners = fns
}

export const posixQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

export const folderBasename = (rootPath: string): string => {
  const trimmed = rootPath.replace(/[\\/]+$/, '')
  const segments = trimmed.split(/[\\/]/)
  return segments[segments.length - 1] || 'project'
}

export const sessionKeyOf = (user: string, hostname: string, port: number): string =>
  sshSessionKey(user, hostname, port)

const userDisconnects = new Set<string>()
const userDisconnectTimers = new Map<string, ReturnType<typeof setTimeout>>()

const clearDisconnectTimer = (key: string): void => {
  const timer = userDisconnectTimers.get(key)
  if (timer === undefined) {
    return
  }
  clearTimeout(timer)
  userDisconnectTimers.delete(key)
}

export const expectUserDisconnect = (user: string, hostname: string, port: number): void => {
  const key = sessionKeyOf(user, hostname, port)
  clearDisconnectTimer(key)
  userDisconnects.add(key)
}

export const takeUserDisconnect = (user: string, hostname: string, port: number): string | null => {
  if (!user) {
    return null
  }
  const exact = sessionKeyOf(user, hostname, port)
  if (!userDisconnects.has(exact)) {
    return null
  }
  userDisconnects.delete(exact)
  clearDisconnectTimer(exact)
  return user
}

export const clearUserDisconnect = (user: string, hostname: string, port: number): void => {
  const key = sessionKeyOf(user, hostname, port)
  userDisconnects.delete(key)
  clearDisconnectTimer(key)
}

export const releaseUserDisconnect = (user: string, hostname: string, port: number): void => {
  const key = sessionKeyOf(user, hostname, port)
  clearDisconnectTimer(key)
  const timer = setTimeout(() => {
    userDisconnectTimers.delete(key)
    userDisconnects.delete(key)
  }, 2000)
  userDisconnectTimers.set(key, timer)
}

export const upsertSession = (next: SshSessionStatus): void => {
  const key = sessionKeyOf(next.user, next.hostname, next.port)
  const remaining = sessions.value.filter(
    (item) => sessionKeyOf(item.user, item.hostname, item.port) !== key,
  )
  remaining.push(next)
  sessions.value = remaining
}

export const sessionForKey = (user: string, hostname: string, port: number): SshSessionStatus | null =>
  sessions.value.find(
    (item) => item.user === user && item.hostname === hostname && item.port === port,
  ) ?? null

export const dialogOwnsError = (): boolean =>
  connectOpen.value || confirmEvent.value !== null || secretEvent.value !== null || changedKey.value !== null

export const stopElapsed = (): void => {
  if (elapsedTimer !== null) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

export const startElapsed = (): void => {
  stopElapsed()
  connectElapsed.value = 0
  elapsedTimer = setInterval(() => {
    connectElapsed.value += 1
  }, 1000)
}

export const resetSecretField = (): void => {
  secretValue.value = ''
  showSecret.value = false
  saveSecret.value = false
}

export const hostKeyPrompt = (prompt: string): boolean =>
  /sha256|fingerprint|authenticity of host|host key/i.test(prompt)

export const canRemoveVixlLine = (body: string): boolean => body.includes('.vixl/ssh/known_hosts')

export const applyConnectError = (title: string, body: string, hostname: string, port: number): void => {
  if (/host key for .+ changed/i.test(title)) {
    changedKey.value = {
      hostname,
      port,
      title,
      body,
      canRemove: canRemoveVixlLine(body),
    }
    connectPhase.value = 'error'
    connectErrorTitle.value = title
    connectErrorBody.value = body
    return
  }
  connectPhase.value = 'error'
  connectErrorTitle.value = title
  connectErrorBody.value = body
}

export const resetConnectForm = (): void => {
  connectHost.value = ''
  connectUser.value = ''
  connectPort.value = '22'
  connectIdentity.value = ''
  connectPasswordOnly.value = false
  connectStatus.value = ''
  connectErrorTitle.value = ''
  connectErrorBody.value = ''
  connectElapsed.value = 0
  preview.value = null
  activePreview.value = null
  banner.value = null
  confirmEvent.value = null
  secretEvent.value = null
  changedKey.value = null
  usedSavedSecret.value = false
  secretAttempt.value = 0
  folderHome.value = ''
  folderCurrent.value = ''
  folderRelative.value = '.'
  folderEntries.value = []
  folderSelected.value = []
  folderError.value = ''
  folderListing.value = false
  connectPhase.value = 'form'
  resetSecretField()
  stopElapsed()
}
