import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'
import useChatStore from '@/composables/use-chat-store'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useVixlConfig from '@/composables/use-vixl-config'
import { refreshFleetSidebar } from '@/composables/use-fleet-sidebar'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import { resolveReasoningForRole } from '@/services/models/resolve-reasoning-for-call'
import loadPrompt from '@/services/prompts/load-prompt'
import { setPendingChatMessage } from '@/services/chat/pending-message'
import updatePlanFrontmatter from '@/services/plans/update-plan-frontmatter'
import {
  clearAwaitingPlanGo,
  setSubagentModelLock,
} from '@/services/harness/plan-execution-session'
import { readChatMeta, updateChatMeta } from '@/services/vixl/vixl-tauri'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { ReasoningLevel } from '@/types/models/reasoning-level'

export type PlanExecutionMode = 'agent' | 'orchestrator'

export type StartPlanBuildInput = {
  projectId: string
  planPath: string
  planTitle: string
  sourceChatId?: string | null
  lastBuildChatId?: string | null
  freshChat?: boolean
  model?: string
  subagentModel?: string
  reasoning?: ReasoningLevel
  subagentReasoning?: ReasoningLevel
  executionMode?: PlanExecutionMode
}

export default () => {
  const router = useRouter()
  const fleet = useFleetRegistry()
  const chatStore = useChatStore()
  const config = useVixlConfig()
  const building = ref(false)

  const resolveExistingChatId = async (
    projectSlug: string,
    candidates: Array<string | null | undefined>,
  ): Promise<string | null> => {
    const seen = new Set<string>()
    for (const candidate of candidates) {
      if (!candidate || seen.has(candidate)) {
        continue
      }
      seen.add(candidate)
      try {
        await readChatMeta(projectSlug, candidate)
        return candidate
      } catch {
        continue
      }
    }
    return null
  }

  const startPlanBuild = async (input: StartPlanBuildInput): Promise<boolean> => {
    if (building.value) {
      return false
    }

    const project = fleet.projects.value.find((item) => item.id === input.projectId)
    if (!project) {
      toast.error('Project not found')
      return false
    }

    const executionMode = input.executionMode ?? 'agent'
    const modelRole = executionMode === 'orchestrator' ? 'orchestrator' : 'agent'
    const chatMode: VixlChatMode =
      executionMode === 'orchestrator' ? 'orchestrator' : 'agent'
    const model =
      input.model?.trim() ||
      resolveModelForRole(modelRole, config.effectiveSettings.value) ||
      ''
    if (!model) {
      toast.error('Select a default model in Settings before building')
      return false
    }

    const subagentModel =
      executionMode === 'orchestrator'
        ? input.subagentModel?.trim() ||
          resolveModelForRole('subagent', config.effectiveSettings.value) ||
          ''
        : null

    if (executionMode === 'orchestrator' && !subagentModel) {
      toast.error('Select a sub-agent model before orchestrating')
      return false
    }

    const reasoning =
      input.reasoning ??
      resolveReasoningForRole(modelRole, config.effectiveSettings.value)
    const subagentReasoning =
      executionMode === 'orchestrator'
        ? input.subagentReasoning ??
          resolveReasoningForRole('subagent', config.effectiveSettings.value)
        : undefined

    const promptPath =
      executionMode === 'orchestrator'
        ? 'handoffs/plan-orchestrate.md'
        : 'handoffs/plan-build.md'
    const prompt = loadPrompt(promptPath, {
      planPath: input.planPath,
      planTitle: input.planTitle,
    })

    building.value = true
    try {
      await fleet.setActiveProject(project.id)

      let chatId: string | null = null
      if (!input.freshChat) {
        chatId = await resolveExistingChatId(project.slug, [
          input.lastBuildChatId,
          input.sourceChatId,
        ])
      }
      if (!chatId) {
        const chat = await chatStore.createNewChat({
          projectSlug: project.slug,
          projectRoot: project.rootPath,
          mode: chatMode,
          model,
          title: input.planTitle,
        })
        chatId = chat.id
      }

      const session = chatStore.forChat(project.slug, chatId)
      if (session.meta.value?.status === 'running') {
        toast.error('Plan is already building in that chat')
        return false
      }

      await updateChatMeta(project.slug, chatId, {
        model,
        mode: chatMode,
        awaitingPlanGo: null,
        subagentModel,
        reasoning: reasoning ?? null,
        subagentReasoning: subagentReasoning ?? null,
      })

      clearAwaitingPlanGo(project.slug, chatId)
      setSubagentModelLock(
        project.slug,
        chatId,
        subagentModel,
        subagentReasoning ?? null,
      )

      setPendingChatMessage({
        text: prompt,
        mode: chatMode,
        model,
        ...(reasoning ? { reasoning } : {}),
        ...(subagentModel ? { subagentModel } : {}),
        ...(subagentReasoning ? { subagentReasoning } : {}),
      })

      await updatePlanFrontmatter({
        projectRoot: project.rootPath,
        path: input.planPath,
        patch: {
          builtAt: new Date().toISOString(),
          lastBuildChatId: chatId,
          lastBuildModel: model,
        },
      })

      await refreshFleetSidebar()
      await router.push(`/project/${project.slug}/chat/${chatId}`)
      return true
    } catch (error) {
      toast.error('Could not start plan build', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      return false
    } finally {
      building.value = false
    }
  }

  return {
    building,
    startPlanBuild,
  }
}
