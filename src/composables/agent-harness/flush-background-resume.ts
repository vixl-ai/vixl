import { toast } from 'vue-sonner'
import {
  clearPendingShellResume,
  hasPendingShellResume,
  hasRunningParentBackgroundShells,
  listDeliverableShellResults,
} from '@/services/harness/shell/registry'
import {
  clearPendingBackgroundResume,
  clearTurnResponseMessages,
  hasPendingBackgroundResume,
  hasRunningSubagentsForChat,
  listDeliverableBackgroundResults,
} from '@/services/harness/subagent/registry'
import { updateChatMeta } from '@/services/vixl/vixl-tauri'
import shouldFlushBackgroundSubagentResume from '@/utils/should-flush-background-subagent-resume'

type FlushBackgroundResumeArgs = {
  chatId: string
  projectSlug: string
  parentBusy: boolean
  holdBackgroundResume: boolean
  patchMeta: (patch: { status: 'idle' }) => void
  refreshSidebar: () => void
  resume: () => Promise<void>
}

export default (args: FlushBackgroundResumeArgs): void => {
  if (args.holdBackgroundResume) {
    return
  }

  const action = shouldFlushBackgroundSubagentResume({
    parentBusy: args.parentBusy,
    hasPending:
      hasPendingBackgroundResume(args.chatId) || hasPendingShellResume(args.chatId),
    hasRunning:
      hasRunningSubagentsForChat(args.chatId) ||
      hasRunningParentBackgroundShells(args.chatId),
    deliverableCount:
      listDeliverableBackgroundResults(args.chatId).length +
      listDeliverableShellResults(args.chatId).length,
  })

  if (action === 'clear') {
    clearPendingBackgroundResume(args.chatId)
    clearPendingShellResume(args.chatId)
    clearTurnResponseMessages(args.chatId)
    updateChatMeta(args.projectSlug, args.chatId, { status: 'idle' })
      .then(() => {
        args.patchMeta({ status: 'idle' })
        args.refreshSidebar()
      })
      .catch((err) => {
        toast.error('Failed to update chat status', {
          description: err instanceof Error ? err.message : 'Unknown error',
        })
      })
    return
  }

  if (action !== 'resume') {
    return
  }

  args.resume().catch((err) => {
    toast.error('Agent resume failed', {
      description: err instanceof Error ? err.message : 'Unknown error',
    })
  })
}
