import type { FileUIPart } from 'ai'
import type { ContextMention } from '@/types/harness/context-mention'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { PermissionCapabilityKey } from '@/types/harness/permission'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'

export type SendArgs = {
  text: string
  mode: VixlChatMode
  model: string
  reasoning?: ReasoningLevel
  mentions?: ContextMention[]
  files?: FileUIPart[]
  skipUserMessage?: boolean
  skipUserPersist?: boolean
  appendedUserMessageId?: string
  continueTurnId?: string
  // Internal sends (drain, retry, edit, forceSendQueued) bypass the outbound
  // composer busy enqueue. They still defer when compaction or a background
  // resume is in flight: drain/retry/edit re-enqueue. Force-send passes
  // queuedItemId, waits instead of deferring, and removes that id when the
  // turn starts. Continue toasts instead of enqueueing.
  internal?: boolean
  queuedItemId?: string
  resumeHoldEpoch?: number
  autoRetryAttempt?: number
}

export type SendResult = 'completed' | 'failed' | 'skipped'

export type SendDeps = {
  handleEvent: (event: HarnessEvent) => void | Promise<void>
  persistPermission: (
    capability: PermissionCapabilityKey,
    verdict: 'allow' | 'deny',
    scope: 'workspace' | 'always',
  ) => Promise<void>
  maybeDrainQueue: () => Promise<void>
}
