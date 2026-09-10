import { ref } from 'vue'
import { toast } from 'vue-sonner'
import useVixlConfig from '@/composables/use-vixl-config'
import type { McpTrustScope } from '@/types/harness/permission'
import type { McpServerConfig } from '@/types/vixl/mcp-config'
import {
  isMcpTrusted,
  sessionTrusts,
  upsertMcpTrustRecord,
  clearSessionTrust,
} from '@/services/mcp/mcp-trust'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import {
  loadEffectiveSettings,
  loadProjectSettings,
  saveSettings,
} from '@/services/config/vixl-config'

type TrustPending = {
  serverId: string
  fingerprint: string
  action: () => Promise<void>
}

type TrustConfig = ReturnType<typeof useVixlConfig>

const persistPersonalAlways = async (
  config: TrustConfig,
  pending: TrustPending,
): Promise<void> => {
  const existing = config.personalSettings.value['agent.mcp.trust'] ?? []
  await config.updateSetting(
    'personal',
    'agent.mcp.trust',
    upsertMcpTrustRecord(existing, pending.serverId, 'always', pending.fingerprint),
  )
}

const persistActiveProjectWorkspace = async (
  config: TrustConfig,
  pending: TrustPending,
): Promise<void> => {
  const existing = config.projectSettings.value['agent.mcp.trust'] ?? []
  await config.updateSetting(
    'project',
    'agent.mcp.trust',
    upsertMcpTrustRecord(existing, pending.serverId, 'workspace', pending.fingerprint),
  )
}

const persistTrustRecord = async (
  config: TrustConfig,
  pending: TrustPending,
  scope: McpTrustScope,
  root?: () => string | null,
): Promise<void> => {
  if (scope === 'never') {
    clearSessionTrust(pending.serverId)
    const existing = config.personalSettings.value['agent.mcp.trust'] ?? []
    await config.updateSetting(
      'personal',
      'agent.mcp.trust',
      upsertMcpTrustRecord(existing, pending.serverId, 'never', pending.fingerprint),
    )
    return
  }

  if (scope === 'session') {
    sessionTrusts.set(pending.serverId, pending.fingerprint)
    return
  }

  if (scope === 'workspace') {
    const requestedRoot = root ? (root() ?? null) : config.activeRootPath.value
    if (root && requestedRoot && requestedRoot !== config.activeRootPath.value) {
      const project = await loadProjectSettings(requestedRoot)
      const existing = project['agent.mcp.trust'] ?? []
      await saveSettings(
        'project',
        {
          ...project,
          'agent.mcp.trust': upsertMcpTrustRecord(
            existing,
            pending.serverId,
            'workspace',
            pending.fingerprint,
          ),
        },
        requestedRoot,
      )
    } else if (requestedRoot) {
      await persistActiveProjectWorkspace(config, pending)
    } else {
      await persistPersonalAlways(config, pending)
    }
    sessionTrusts.set(pending.serverId, pending.fingerprint)
    return
  }

  await persistPersonalAlways(config, pending)
  sessionTrusts.set(pending.serverId, pending.fingerprint)
}

export default (root?: () => string | null) => {
  const config = useVixlConfig()
  const trustPending = ref<TrustPending | null>(null)
  const trustSaving = ref(false)

  const requireTrust = async (
    id: string,
    serverConfig: McpServerConfig,
    action: () => Promise<void>,
  ): Promise<void> => {
    const fingerprint = mcpServerFingerprint(serverConfig)
    const settings = root
      ? await loadEffectiveSettings(root() ?? null)
      : config.effectiveSettings.value
    if (isMcpTrusted(settings, id, fingerprint, sessionTrusts)) {
      await action()
      return
    }
    trustPending.value = { serverId: id, fingerprint, action }
  }

  const handleTrustChoice = async (scope: McpTrustScope): Promise<void> => {
    const pending = trustPending.value
    if (!pending) {
      return
    }
    trustPending.value = null
    trustSaving.value = true

    try {
      await persistTrustRecord(config, pending, scope, root)
    } catch (error) {
      toast.error('Failed to trust server', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      return
    } finally {
      trustSaving.value = false
    }

    if (scope === 'never') {
      return
    }

    try {
      await pending.action()
    } catch (error) {
      toast.error('Failed to start server', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return {
    trustPending,
    trustSaving,
    requireTrust,
    handleTrustChoice,
  }
}
