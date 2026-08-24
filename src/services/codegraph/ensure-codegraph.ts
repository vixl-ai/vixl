import useMcpServers from '@/composables/use-mcp-servers'
import { migrateMcpConfig } from '@/schemas/mcp-config'
import stripCodegraphMcpServer from '@/services/codegraph/strip-codegraph-mcp-server'
import {
  loadProjectSettings,
  saveSettings,
} from '@/services/config/vixl-config'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import { sessionTrusts } from '@/services/mcp/mcp-trust'
import { mcpServerFingerprint } from '@/services/mcp/mcp-server-fingerprint'
import {
  CODEGRAPH_SERVER_ID,
  buildCodegraphServer,
} from '@/types/codegraph/managed-codegraph'
import {
  codegraphCli,
  codegraphStoreStat,
  isTauri,
  readMcpConfig,
  writeMcpConfig,
} from '@/services/vixl/vixl-tauri'
import invokeErrorMessage from '@/utils/invoke-error-message'

const inFlightByRoot = new Map<string, Promise<void>>()

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms)
  })

const persistStrippedMcpConfig = async (
  scope: 'personal' | 'project',
  root: string | null,
): Promise<void> => {
  const raw = await readMcpConfig(scope, root)
  const migrated = migrateMcpConfig(raw)
  if (!(CODEGRAPH_SERVER_ID in migrated.servers)) {
    return
  }
  const cleaned = stripCodegraphMcpServer(migrated)
  await writeMcpConfig(scope, cleaned, root)
}

const pruneObsoleteCodegraphTrust = async (root: string): Promise<void> => {
  const projectSettings = await loadProjectSettings(root)
  const existing = projectSettings['agent.mcp.trust'] ?? []
  const next = existing.filter((record) => record.serverId !== CODEGRAPH_SERVER_ID)
  if (next.length === existing.length) {
    return
  }
  if (next.length === 0) {
    const rest = { ...projectSettings }
    delete rest['agent.mcp.trust']
    await saveSettings('project', { ...rest, version: 1 }, root)
    return
  }
  await saveSettings(
    'project',
    {
      ...projectSettings,
      version: 1,
      'agent.mcp.trust': next,
    },
    root,
  )
}

const ensureCodeGraphOnce = async (root: string): Promise<void> => {
  const store = await codegraphStoreStat(root)
  if (!store.dbExists) {
    await codegraphCli(root, 'init')
  }

  await persistStrippedMcpConfig('project', root)
  await persistStrippedMcpConfig('personal', null)
  await pruneObsoleteCodegraphTrust(root)

  const server = buildCodegraphServer(root)
  sessionTrusts.set(CODEGRAPH_SERVER_ID, mcpServerFingerprint(server))

  const mcp = useMcpServers()
  await mcp.loadConfigs(root)

  const existing = await mcpRuntime.getStatus(CODEGRAPH_SERVER_ID)
  if (existing.status === 'connected') {
    return
  }

  await mcp.startServer(CODEGRAPH_SERVER_ID, server, { quiet: true })

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await mcpRuntime.getStatus(CODEGRAPH_SERVER_ID)
    if (status.status === 'connected') {
      return
    }
    if (status.status === 'error') {
      throw new Error(status.error ?? 'CodeGraph failed to start')
    }
    await wait(250)
  }

  const finalStatus = await mcpRuntime.getStatus(CODEGRAPH_SERVER_ID)
  throw new Error(
    finalStatus.error ??
      `CodeGraph is ${finalStatus.status || 'not running'}`,
  )
}

/**
 * Ensure CodeGraph is initialized and started for the project root.
 * Config lives in memory only; never writes CodeGraph into user MCP JSON.
 * Concurrent calls for the same root share one in-flight start.
 */
export default async (projectRoot: string): Promise<void> => {
  if (!isTauri()) {
    return
  }

  const root = projectRoot.trim()
  if (!root) {
    return
  }

  const existing = inFlightByRoot.get(root)
  if (existing) {
    await existing
    return
  }

  const pending = (async () => {
    try {
      await ensureCodeGraphOnce(root)
    } catch (error) {
      throw error instanceof Error ? error : new Error(invokeErrorMessage(error))
    } finally {
      inFlightByRoot.delete(root)
    }
  })()

  inFlightByRoot.set(root, pending)
  await pending
}
