import { computed } from 'vue'
import {
  sshAnswerConfirm,
  sshAnswerSecret,
  sshCancelPrompt,
  sshRemoveVixlHostKey,
  sshSavePassphrase,
  sshSavePassword,
} from '@/services/vixl/vixl-tauri/ssh'
import { parseSshConnectError } from '@/utils/ssh-destination'
import * as state from './state'

export const answerHostKey = async (trusted: boolean, alsoAdd: boolean): Promise<void> => {
  const event = state.confirmEvent.value
  if (!event) {
    return
  }
  state.confirmEvent.value = null
  try {
    await sshAnswerConfirm(event.requestId, trusted, alsoAdd)
  } catch (error) {
    const copy = parseSshConnectError(error)
    state.applyConnectError(copy.title, copy.body, event.hostname, event.port)
  }
}

export const submitSecret = async (): Promise<void> => {
  const event = state.secretEvent.value
  if (!event) {
    return
  }
  const value = state.secretValue.value
  const shouldSave = state.saveSecret.value && event.saveable
  const previewUser = state.activePreview.value?.user || state.connectUser.value.trim()
  state.secretEvent.value = null
  state.usedSavedSecret.value = false
  try {
    await sshAnswerSecret(event.requestId, value)
    if (shouldSave && event.kind === 'password' && previewUser) {
      await sshSavePassword(previewUser, event.hostname, event.port, value)
    }
    if (shouldSave && event.kind === 'passphrase') {
      const identity = state.activePreview.value?.identityFiles[0]
      if (identity) {
        await sshSavePassphrase(identity, value)
      }
    }
  } catch (error) {
    const copy = parseSshConnectError(error)
    state.applyConnectError(copy.title, copy.body, event.hostname, event.port)
  }
  state.resetSecretField()
}

export const cancelSecret = async (): Promise<void> => {
  const event = state.secretEvent.value
  if (!event) {
    return
  }
  state.secretEvent.value = null
  state.resetSecretField()
  try {
    await sshCancelPrompt(event.requestId)
  } catch {
    void 0
  }
}

export const focusSecretDialog = (): void => {
  state.secretFocusEl.value?.focus()
}

export const openRemoveStoredKey = (): void => {
  state.removeKeyOpen.value = true
}

export const confirmRemoveStoredKey = async (): Promise<void> => {
  const current = state.changedKey.value
  if (!current) {
    state.removeKeyOpen.value = false
    return
  }
  try {
    await sshRemoveVixlHostKey(current.hostname, current.port)
    state.removeKeyOpen.value = false
    state.changedKey.value = null
    state.connectPhase.value = 'form'
    state.connectErrorTitle.value = ''
    state.connectErrorBody.value = ''
  } catch (error) {
    const copy = parseSshConnectError(error)
    state.connectErrorTitle.value = copy.title
    state.connectErrorBody.value = copy.body
    state.removeKeyOpen.value = false
  }
}

export const secretTitle = computed((): string => {
  const event = state.secretEvent.value
  const current = state.activePreview.value
  if (!event) {
    return ''
  }
  const user = current?.user || state.connectUser.value.trim() || 'user'
  if (state.usedSavedSecret.value && event.kind === 'password') {
    return `The saved password for ${event.hostname} was rejected.`
  }
  if (event.kind === 'passphrase') {
    const name = current?.identityFiles[0]?.split(/[\\/]/).pop() ?? 'key'
    if (state.secretAttempt.value > 0) {
      return `Passphrase was not accepted for ${name}.`
    }
    return `Passphrase for ${name}.`
  }
  if (event.kind === 'otp') {
    return `Verification code for ${user}@${event.hostname}.`
  }
  if (event.kind === 'pin') {
    return 'PIN for the security key.'
  }
  if (state.secretAttempt.value > 0) {
    return `Permission denied for ${user}@${event.hostname}.`
  }
  return `Password for ${user}@${event.hostname}.`
})

export const secretBody = computed((): string => {
  const event = state.secretEvent.value
  if (!event) {
    return ''
  }
  if (state.usedSavedSecret.value && event.kind === 'password') {
    return 'Type the password to try again. The saved password was sent once and will not be sent again.'
  }
  if (event.kind === 'passphrase' && state.secretAttempt.value > 0) {
    return event.prompt
  }
  if (event.kind === 'password' && state.secretAttempt.value > 0) {
    return `Permission denied, please try again. Attempt ${state.secretAttempt.value + 1} of 3.`
  }
  if (event.kind === 'passphrase') {
    const path = state.activePreview.value?.identityFiles[0] ?? 'the key'
    return `Enter the passphrase for ${path}. ${event.hostname} asks for this key before a password.`
  }
  return event.prompt || 'Cancel sends nothing. An empty password is sent as an empty password.'
})

export const hostKeyTitle = computed((): string => {
  const event = state.confirmEvent.value
  if (!event) {
    return ''
  }
  if (event.port !== 22) {
    return `Trust the host key for ${event.hostname} port ${event.port}?`
  }
  return `Trust the host key for ${event.hostname}?`
})

export const hostKeyBody = computed((): string => {
  const event = state.confirmEvent.value
  if (!event) {
    return ''
  }
  const keyType = event.keyType ?? 'host'
  const fingerprint = event.fingerprint ? `Fingerprint: ${event.fingerprint}.` : event.prompt
  const address = event.address ? ` Address: ${event.address}.` : ''
  return `OpenSSH has not seen this ${keyType} key for ${event.hostname} port ${event.port}. ${fingerprint} This key is not known by any other names.${address}`
})
