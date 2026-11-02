import { listen } from '@tauri-apps/api/event'
import { toast } from 'vue-sonner'
import { isTauri } from '@/services/vixl/vixl-tauri'
import {
  sshListAliases,
  sshListSessions,
  type SshBannerEvent,
  type SshConfirmEvent,
  type SshErrorEvent,
  type SshSecretEvent,
  type SshStatusEvent,
} from '@/services/vixl/vixl-tauri/ssh'
import * as state from './state'

export const loadAliases = async (): Promise<void> => {
  if (!isTauri()) {
    state.aliases.value = []
    return
  }
  try {
    state.aliases.value = await sshListAliases()
  } catch {
    state.aliases.value = []
  }
}

export const refreshSessions = async (): Promise<void> => {
  if (!isTauri()) {
    return
  }
  try {
    state.sessions.value = await sshListSessions()
  } catch {
    state.sessions.value = []
  }
}

const handleStatus = (event: SshStatusEvent): void => {
  state.connectStatus.value = event.line
  if (event.line.toLowerCase().includes('using the saved')) {
    state.usedSavedSecret.value = true
  }
  const existing = state.sessionForKey(event.user, event.hostname, event.port)
  state.upsertSession({
    user: event.user,
    hostname: event.hostname,
    port: event.port,
    destination: existing?.destination ?? '',
    state: existing?.state ?? 'connecting',
    line: event.line,
    lastError: existing?.lastError ?? null,
    masterAlive: existing?.masterAlive ?? false,
  })
}

const handleConfirm = (event: SshConfirmEvent): void => {
  state.confirmEvent.value = event
}

const handleSecret = (event: SshSecretEvent): void => {
  if (state.secretEvent.value && state.secretEvent.value.kind === event.kind) {
    state.secretAttempt.value += 1
  } else {
    state.secretAttempt.value = state.usedSavedSecret.value ? 1 : 0
  }
  state.secretEvent.value = event
  state.resetSecretField()
}

const handleBanner = (event: SshBannerEvent): void => {
  state.banner.value = event
}

export const handleSshError = (event: SshErrorEvent): void => {
  const previewUser = state.activePreview.value?.user || state.connectUser.value.trim()
  const existing = state.sessions.value.find(
    (item) => item.hostname === event.hostname && item.port === event.port,
  )
  const acknowledgedUser = state.takeUserDisconnect(
    existing?.user || previewUser || '',
    event.hostname,
    event.port,
  )
  if (acknowledgedUser) {
    state.upsertSession({
      user: existing?.user || acknowledgedUser,
      hostname: event.hostname,
      port: event.port,
      destination: existing?.destination ?? '',
      state: 'disconnected',
      line: `Disconnected from ${event.hostname}.`,
      lastError: null,
      masterAlive: false,
    })
    return
  }
  const key = state.sessionKeyOf(
    existing?.user || previewUser || 'user',
    event.hostname,
    event.port,
  )
  state.upsertSession({
    user: existing?.user ?? previewUser ?? '',
    hostname: event.hostname,
    port: event.port,
    destination: existing?.destination ?? '',
    state: 'disconnected',
    line: event.title,
    lastError: { title: event.title, body: event.body },
    masterAlive: false,
  })
  if (state.dialogOwnsError()) {
    state.applyConnectError(event.title, event.body, event.hostname, event.port)
    state.secretEvent.value = null
    state.confirmEvent.value = null
    return
  }
  if (state.toastedDeath.has(key)) {
    return
  }
  state.toastedDeath.add(key)
  const lower = `${event.title} ${event.body}`.toLowerCase()
  if (lower.includes('stopped responding')) {
    toast.error(`${event.hostname} stopped responding.`, {
      description:
        'The connection stopped answering. Vixl disconnected. Reconnect from the project when you want a new login.',
    })
    return
  }
  if (lower.includes('closed the connection')) {
    toast.error(`${event.hostname} closed the connection.`, {
      description: event.body || event.title,
    })
    return
  }
  toast.error(`${event.hostname} disconnected.`, {
    description: event.body || event.title,
  })
}

export const bindListeners = async (): Promise<void> => {
  if (state.listenersBound || !isTauri()) {
    return
  }
  state.setListeners(
    await Promise.all([
      listen<SshStatusEvent>('ssh://status', (event) => handleStatus(event.payload)),
      listen<SshConfirmEvent>('ssh://confirm', (event) => handleConfirm(event.payload)),
      listen<SshSecretEvent>('ssh://secret', (event) => handleSecret(event.payload)),
      listen<SshBannerEvent>('ssh://banner', (event) => handleBanner(event.payload)),
      listen<SshErrorEvent>('ssh://error', (event) => handleSshError(event.payload)),
    ]),
  )
  await refreshSessions()
}
