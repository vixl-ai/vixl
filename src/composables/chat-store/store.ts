import { computed } from 'vue'
import type { ChatMeta } from '@/types/chat/chat-meta'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import {
  createChat,
  listChats,
  readChatMeta,
} from '@/services/vixl/vixl-tauri'
import {
  activeKey,
  clearCompletedOrErrorAttention,
  getActiveSession,
  getOrCreateSession,
  makeSessionKey,
  mapMeta,
  restorePendingQuestion,
  sessions,
  todosFromTimeline,
} from './helpers'
import hydrateSessionFromDisk from './hydrate'
import { bindSessionMutations } from './session-mutations'
import createActiveSessionFacade from './active-session-facade'
import type { SessionMutations } from './types'

const useChatStore = () => {
  const meta = computed(() => getActiveSession()?.meta.value ?? null)
  const messages = computed(() => getActiveSession()?.messages.value ?? [])
  const timeline = computed(() => getActiveSession()?.timeline.value ?? [])
  const loading = computed(() => getActiveSession()?.loading.value ?? false)
  const pendingQuestion = computed(
    () => getActiveSession()?.pendingQuestion.value ?? null,
  )
  const editingMessageId = computed(
    () => getActiveSession()?.editingMessageId.value ?? null,
  )
  const editDraftText = computed(() => getActiveSession()?.editDraftText.value ?? '')
  const chatId = computed(() => meta.value?.id ?? null)
  const todos = computed(() => todosFromTimeline(timeline.value))

  const forChat = (projectSlug: string, chatIdValue: string): SessionMutations =>
    bindSessionMutations(getOrCreateSession(projectSlug, chatIdValue))

  const isSessionActive = (projectSlug: string, chatIdValue: string): boolean =>
    activeKey.value === makeSessionKey(projectSlug, chatIdValue)

  const isSessionWarm = (projectSlug: string, chatIdValue: string): boolean => {
    const session = sessions.get(makeSessionKey(projectSlug, chatIdValue))
    return Boolean(session?.warm)
  }

  const selectChat = (projectSlug: string, chatIdValue: string): SessionMutations => {
    const session = getOrCreateSession(projectSlug, chatIdValue)
    activeKey.value = session.key
    return bindSessionMutations(session)
  }

  const dropSession = (projectSlug: string, chatIdValue: string): void => {
    const key = makeSessionKey(projectSlug, chatIdValue)
    sessions.delete(key)
    if (activeKey.value === key) {
      activeKey.value = null
    }
  }

  const ensureChatHydrated = async (
    projectSlug: string,
    chatIdValue: string,
  ): Promise<'keepLive' | 'warmIdle' | 'cold'> => {
    const session = getOrCreateSession(projectSlug, chatIdValue)
    activeKey.value = session.key

    const keepLive =
      session.warm &&
      (session.meta.value?.status === 'running' || session.activeTurnId.value !== null)

    if (keepLive) {
      session.loading.value = true
      try {
        const metaRecord = await readChatMeta(projectSlug, chatIdValue)
        session.meta.value = mapMeta(metaRecord)
        await clearCompletedOrErrorAttention(session)
        restorePendingQuestion(session)
      } finally {
        session.loading.value = false
      }
      return 'keepLive'
    }

    // Idle warm: in-memory timeline is already the navigation cache. Skip
    // full jsonl rebuild. Optional meta refresh stays off the paint path.
    if (session.warm) {
      return 'warmIdle'
    }

    session.loading.value = true
    try {
      await hydrateSessionFromDisk(session)
      await clearCompletedOrErrorAttention(session)
      restorePendingQuestion(session)
    } finally {
      session.loading.value = false
    }
    return 'cold'
  }

  const refreshChatMeta = async (
    projectSlug: string,
    chatIdValue: string,
  ): Promise<void> => {
    const session = getOrCreateSession(projectSlug, chatIdValue)
    const metaRecord = await readChatMeta(projectSlug, chatIdValue)
    session.meta.value = mapMeta(metaRecord)
    await clearCompletedOrErrorAttention(session)
    restorePendingQuestion(session)
  }

  const loadChat = async (projectSlug: string, chatIdValue: string): Promise<void> => {
    selectChat(projectSlug, chatIdValue)
    await ensureChatHydrated(projectSlug, chatIdValue)
  }

  const createNewChat = async (args: {
    projectSlug: string
    projectRoot: string
    mode: VixlChatMode
    model: string
    title?: string
  }): Promise<ChatMeta> => {
    const record = await createChat(args)
    const session = getOrCreateSession(record.projectSlug, record.id)
    session.meta.value = mapMeta(record)
    session.messages.value = []
    session.timeline.value = []
    session.activeTurnId.value = null
    session.activeStepId.value = null
    session.pendingStepText.value = ''
    session.pendingQuestion.value = null
    session.editingMessageId.value = null
    session.editDraftText.value = ''
    session.warm = true
    activeKey.value = session.key
    return session.meta.value
  }

  const listProjectChats = async (projectSlug: string): Promise<ChatMeta[]> => {
    const records = await listChats(projectSlug)
    return records.map(mapMeta)
  }

  const clearChatState = (): void => {
    activeKey.value = null
  }

  const facade = createActiveSessionFacade()

  return {
    meta,
    messages,
    timeline,
    loading,
    chatId,
    pendingQuestion,
    todos,
    editingMessageId,
    editDraftText,
    activeKey,
    forChat,
    isSessionActive,
    isSessionWarm,
    selectChat,
    dropSession,
    ensureChatHydrated,
    refreshChatMeta,
    loadChat,
    createNewChat,
    listProjectChats,
    clearChatState,
    ...facade,
  }
}

export default useChatStore
