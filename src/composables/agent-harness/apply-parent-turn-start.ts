import { toast } from 'vue-sonner'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import type { ContextMention } from '@/types/harness/context-mention'
import type { ReasoningLevel } from '@/types/models/reasoning-level'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'
import type { AgentHarnessState } from './types'

type ApplyParentTurnStartArgs = {
  state: AgentHarnessState
  mode: VixlChatMode
  model: string
  reasoning?: ReasoningLevel
  mentions: ContextMention[]
  effectiveSettings: VixlSettings
}

export default (args: ApplyParentTurnStartArgs): void => {
  const { state, mode, model, reasoning, mentions, effectiveSettings } = args
  const { options, session, lastRunConfig, subagents, contextBudgetSync } = state

  lastRunConfig.value = {
    mode,
    model,
    reasoning,
    mentions,
    effectiveSettings,
  }
  subagents.value = subagents.value.filter((item) => item.status === 'running')
  contextBudgetSync.setDraftMentions(mentions)

  // The turn must not wait on this write; failures are surfaced, never thrown.
  updateChatMeta(options.projectSlug, options.chatId, { model, mode })
    .then(() => {
      session.patchMeta({ model, mode })
    })
    .catch((metaError: unknown) => {
      toast.error('Failed to save chat model', {
        description:
          metaError instanceof Error ? metaError.message : 'Unknown error',
      })
    })
}
