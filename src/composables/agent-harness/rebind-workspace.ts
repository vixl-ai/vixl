import { toast } from 'vue-sonner'
import type { HarnessEvent } from '@/types/harness/harness-event'
import chatRouteFor from '@/utils/chat-route-for'
import router from '@/router'
import {
  getPlanExecutionSession,
  rekeyPlanExecutionSession,
} from '@/services/harness/plan-execution-session'
import { rekeyPlanTab } from '@/composables/workbench-store/rekey-plan-tab'
import { revealFleetProject } from '@/composables/fleet-project-reveal'
import useProjectsExpansion from '@/composables/use-projects-expansion'
import { upsertFleetProject } from '@/composables/use-fleet-registry'
import { forgetSidebarChats } from '@/composables/use-fleet-sidebar'
import { rekeyAgentHarness } from './cache'
import type { AgentHarnessState } from './types'

type WorkspaceMovedEvent = Extract<HarnessEvent, { type: 'workspace-moved' }>

const planIdFromPath = (path: string): string | null => {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    return null
  }
  const fileName = segments[segments.length - 1]
  if (fileName === 'PLAN.md') {
    return segments[segments.length - 2] ?? null
  }
  return fileName ?? null
}

export default async (
  state: AgentHarnessState,
  event: WorkspaceMovedEvent,
): Promise<void> => {
  const { options } = state
  const fromProjectSlug = event.fromProjectSlug

  options.projectSlug = event.projectSlug
  options.projectRoot = event.projectRoot
  options.projectName = event.project.name
  options.standalone = false

  state.chatStore.rekeySession(fromProjectSlug, event.chatId, {
    projectSlug: event.projectSlug,
    projectRoot: event.projectRoot,
  })
  rekeyAgentHarness(fromProjectSlug, event.chatId, event.projectSlug)
  rekeyPlanExecutionSession(fromProjectSlug, event.chatId, event.projectSlug)

  const activePlanPath = getPlanExecutionSession(
    event.projectSlug,
    event.chatId,
  ).activePlanPath
  const planId = activePlanPath ? planIdFromPath(activePlanPath) : null
  if (planId) {
    rekeyPlanTab(event.project.id, planId)
  }

  if (options.loadedThreadKey) {
    options.loadedThreadKey.value = `${event.projectSlug}:${event.chatId}`
  }

  upsertFleetProject({
    id: event.project.id,
    name: event.project.name,
    slug: event.project.slug,
    root_path: event.project.rootPath,
    last_opened: new Date().toISOString(),
  })
  forgetSidebarChats(event.projectSlug)

  const report = (error: unknown): void => {
    toast.error('Failed to rebind workspace', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }

  try {
    await state.fleet.refresh()
  } catch (error: unknown) {
    report(error)
  }

  try {
    await state.fleet.setActiveProject(event.project.id)
  } catch (error: unknown) {
    report(error)
  }

  const expansion = useProjectsExpansion()
  if (expansion.expansionMode.value === 'all-collapsed') {
    expansion.expansionMode.value = 'natural'
  }
  revealFleetProject(event.projectSlug)

  try {
    await state.fleetSidebar.refreshAll()
  } catch (error: unknown) {
    report(error)
  }

  try {
    await router.replace(chatRouteFor(event.projectSlug, event.chatId))
  } catch (error: unknown) {
    report(error)
    throw error
  }
}
