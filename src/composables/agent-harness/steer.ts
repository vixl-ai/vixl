import { toast } from 'vue-sonner'
import deliverSteer from '@/services/harness/subagent/deliver-steer'
import { getSubagent } from '@/services/harness/subagent/registry'
import { loadEffectiveSettings } from '@/services/config/vixl-config'
import type { HarnessEvent } from '@/types/harness/harness-event'
import type { PermissionCapabilityKey } from '@/types/harness/permission'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { AgentHarnessState } from './types'

type SteerDeps = {
  handleEvent: (event: HarnessEvent) => void | Promise<void>
  persistPermission: (
    capability: PermissionCapabilityKey,
    verdict: 'allow' | 'deny',
    scope: 'workspace' | 'always',
  ) => Promise<void>
}

export default (state: AgentHarnessState, deps: SteerDeps) => {
  const buildContext = async (): Promise<HarnessToolContext | null> => {
    const { options, session, lastRunConfig, sessionPermissionLevel } = state
    const projectRoot = options.standalone ? null : options.projectRoot
    let settings
    try {
      settings = await loadEffectiveSettings(projectRoot)
    } catch (settingsError) {
      toast.error('Failed to load project settings', {
        description:
          settingsError instanceof Error ? settingsError.message : 'Unknown error',
      })
      return null
    }

    return {
      projectRoot: options.projectRoot,
      projectSlug: options.projectSlug,
      chatId: options.chatId,
      mode: lastRunConfig.value?.mode ?? session.meta.value?.mode ?? 'agent',
      settings,
      permissionLevel:
        sessionPermissionLevel.value ??
        settings['agent.permissionLevel'] ??
        'allowlist',
      sessionAllows: state.sessionAllows,
      sessionDenies: state.sessionDenies,
      sandboxEnabled: settings['agent.sandbox.enabled'] ?? true,
      supportsVision: false,
      onPendingApproval: (entry) => {
        deps.handleEvent({
          type: 'tool-pending-approval',
          toolCallId: entry.toolCallId,
          name: entry.name,
          kind: entry.kind,
          title: entry.title,
          detail: entry.detail,
          unsandboxed: entry.unsandboxed,
          needsNetwork: entry.needsNetwork,
          allowedScopes: entry.allowedScopes,
          diff: entry.diff ?? [],
          subagentId: entry.subagentId,
          subagentLabel: entry.subagentLabel,
        })
      },
      persistPermission: deps.persistPermission,
      onHarnessEvent: deps.handleEvent,
    }
  }

  const steerSubagent = async (
    subagentId: string,
    text: string,
  ): Promise<void> => {
    const message = text.trim()
    if (!message) {
      return
    }

    const ctx = await buildContext()
    if (!ctx) {
      return
    }

    const existing = state.subagents.value.find(
      (item) => item.subagentId === subagentId,
    )
    const previousHarnessStatus = existing?.status
    const timeline = state.session.getSubagent(subagentId)
    const previousTimelineStatus =
      timeline?.status ?? previousHarnessStatus ?? 'done'

    state.session.queueLocalSubagentSteer(subagentId, message)
    if (existing) {
      state.subagents.value = state.subagents.value.map((item) =>
        item.subagentId === subagentId ? { ...item, status: 'running' } : item,
      )
    } else {
      const registryRecord = getSubagent(subagentId)
      state.subagents.value = [
        ...state.subagents.value,
        {
          subagentId,
          name: timeline?.name ?? registryRecord?.agentName ?? subagentId,
          blocking: timeline?.blocking ?? true,
          status: 'running',
          events: [],
        },
      ]
    }

    const rollbackSteer = (): void => {
      state.session.rollbackLocalSubagentSteer(
        subagentId,
        message,
        previousTimelineStatus,
      )
      if (!existing) {
        state.subagents.value = state.subagents.value.filter(
          (item) => item.subagentId !== subagentId,
        )
        return
      }
      if (!previousHarnessStatus) {
        return
      }
      state.subagents.value = state.subagents.value.map((item) =>
        item.subagentId === subagentId
          ? { ...item, status: previousHarnessStatus }
          : item,
      )
    }

    try {
      await deliverSteer(
        ctx,
        subagentId,
        message,
        getSubagent(subagentId)?.agentName ??
          existing?.name ??
          timeline?.name ??
          '',
      )
    } catch (error) {
      rollbackSteer()
      toast.error('Failed to steer subagent', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return { steerSubagent }
}
