import { toast } from 'vue-sonner'
import type { StartPlanBuildInput } from '@/composables/use-start-plan-build'

type PlanBuildActionsInput = {
  projectId: () => string
  planPath: () => string
  planTitle: () => string
  sourceChatId: { value: string | null }
  lastBuildChatId: { value: string | null }
  startPlanBuild: (input: StartPlanBuildInput) => Promise<boolean>
  loadPlan: () => Promise<void>
}

export default (input: PlanBuildActionsInput) => {
  const handleBuildNowConfirm = (payload: {
    model: string
    freshChat: boolean
  }): void => {
    input
      .startPlanBuild({
        projectId: input.projectId(),
        planPath: input.planPath(),
        planTitle: input.planTitle(),
        sourceChatId: input.sourceChatId.value,
        lastBuildChatId: input.lastBuildChatId.value,
        model: payload.model,
        freshChat: payload.freshChat,
        executionMode: 'agent',
      })
      .then(async (success) => {
        if (success) {
          await input.loadPlan()
        }
      })
      .catch((error) => {
        toast.error('Could not start plan build', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
  }

  const handleOrchestrateConfirm = (payload: {
    parentModel: string
    subagentModel: string
  }): void => {
    input
      .startPlanBuild({
        projectId: input.projectId(),
        planPath: input.planPath(),
        planTitle: input.planTitle(),
        sourceChatId: input.sourceChatId.value,
        lastBuildChatId: input.lastBuildChatId.value,
        model: payload.parentModel,
        subagentModel: payload.subagentModel,
        executionMode: 'orchestrator',
      })
      .then(async (success) => {
        if (success) {
          await input.loadPlan()
        }
      })
      .catch((error) => {
        toast.error('Could not start orchestration', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      })
  }

  return {
    handleBuildNowConfirm,
    handleOrchestrateConfirm,
  }
}
