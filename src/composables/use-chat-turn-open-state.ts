import type { InjectionKey, MaybeRefOrGetter, Ref } from 'vue'
import { inject, provide, ref, toValue, watch } from 'vue'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'

export const CHAT_TURN_OPEN_STATE_KEY: InjectionKey<ChatTurnOpenState> = Symbol(
  'chat-turn-open-state',
)

export const chatTurnOpenKeys = {
  tool: (toolCallId: string): string => `tool:${toolCallId}`,
  reasoning: (turnId: string, stepId: string): string => `reasoning:${turnId}:${stepId}`,
  chainOfThought: (turnId: string, stepId: string, segmentIndex: number): string =>
    `cot:${turnId}:${stepId}:${segmentIndex}`,
  filesChanged: (turnId: string): string => `files:${turnId}`,
}

export type ChatTurnOpenState = {
  get: (id: string) => boolean | undefined
  set: (id: string, open: boolean) => void
  prune: (liveIds: Set<string>) => void
  size: () => number
}

export function isChatTurnOpenKeyLive(key: string, liveIds: Set<string>): boolean {
  const parts = key.split(':')
  const kind = parts[0]
  const entityId = parts[1]
  if (!entityId) {
    return false
  }
  if (kind === 'tool' || kind === 'files' || kind === 'reasoning' || kind === 'cot') {
    return liveIds.has(entityId)
  }
  return false
}

export function collectChatTurnOpenLiveIds(
  timeline: readonly ChatTimelineItem[],
): Set<string> {
  const live = new Set<string>()
  for (const item of timeline) {
    if (item.type === 'agent-turn') {
      if (item.turn.id) {
        live.add(item.turn.id)
      }
      for (const step of item.turn.steps) {
        for (const tool of step.tools) {
          if (tool.toolCallId) {
            live.add(tool.toolCallId)
          }
        }
      }
      continue
    }
    if (item.type === 'subagent') {
      for (const tool of item.tools) {
        if (tool.toolCallId) {
          live.add(tool.toolCallId)
        }
      }
    }
  }
  return live
}

export function createChatTurnOpenState(): ChatTurnOpenState {
  const openById = new Map<string, boolean>()

  return {
    get(id: string): boolean | undefined {
      return openById.get(id)
    },
    set(id: string, open: boolean): void {
      openById.set(id, open)
    },
    prune(liveIds: Set<string>): void {
      for (const key of openById.keys()) {
        if (!isChatTurnOpenKeyLive(key, liveIds)) {
          openById.delete(key)
        }
      }
    },
    size(): number {
      return openById.size
    },
  }
}

export function provideChatTurnOpenState(): ChatTurnOpenState {
  const state = createChatTurnOpenState()
  provide(CHAT_TURN_OPEN_STATE_KEY, state)
  return state
}

export function useChatTurnOpenState(): ChatTurnOpenState | null {
  return inject(CHAT_TURN_OPEN_STATE_KEY, null)
}

export function usePersistedCollapsibleOpen(
  id: MaybeRefOrGetter<string | undefined>,
  options: {
    defaultOpen?: MaybeRefOrGetter<boolean>
    restore?: MaybeRefOrGetter<boolean>
    write?: MaybeRefOrGetter<boolean>
  } = {},
): {
  open: Ref<boolean>
  setProgrammatic: (value: boolean) => void
} {
  const store = useChatTurnOpenState()
  const shouldRestore = (): boolean => toValue(options.restore) ?? true
  const shouldWrite = (): boolean => toValue(options.write) ?? true
  const fallback = (): boolean => toValue(options.defaultOpen) ?? false

  const initialKey = toValue(id)
  const persisted =
    shouldRestore() && initialKey && store ? store.get(initialKey) : undefined
  const open = ref(persisted ?? fallback())

  let pauseWrites = false

  watch(
    open,
    (value) => {
      if (pauseWrites || !shouldWrite()) {
        return
      }
      const key = toValue(id)
      if (!key || !store) {
        return
      }
      store.set(key, value)
    },
    { flush: 'sync' },
  )

  const setProgrammatic = (value: boolean): void => {
    pauseWrites = true
    open.value = value
    pauseWrites = false
  }

  return { open, setProgrammatic }
}

export function bindPersistedOpen(
  open: Ref<boolean | undefined>,
  id: MaybeRefOrGetter<string | undefined>,
  options: {
    write?: MaybeRefOrGetter<boolean>
  } = {},
): { setProgrammatic: (value: boolean) => void } {
  const store = useChatTurnOpenState()
  const shouldWrite = (): boolean => toValue(options.write) ?? true
  let pauseWrites = false

  watch(
    open,
    (value) => {
      if (pauseWrites || !shouldWrite() || typeof value !== 'boolean') {
        return
      }
      const key = toValue(id)
      if (!key || !store) {
        return
      }
      store.set(key, value)
    },
    { flush: 'sync' },
  )

  const setProgrammatic = (value: boolean): void => {
    pauseWrites = true
    open.value = value
    pauseWrites = false
  }

  return { setProgrammatic }
}
