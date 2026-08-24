import {
  listEffectiveMcpServers,
  listScopedMcpServers,
  listUserMcpServers,
} from '@/services/mcp/merge-mcp-config'
import useVixlConfig from '@/composables/use-vixl-config'
import { loadConfigs, refreshStates } from './config'
import {
  addServer,
  createSetServerEnabled,
  deleteServer,
  updateServer,
  upsertServer,
} from './crud'
import {
  createAssertTrustedOrThrow,
  createAuthenticateServer,
  createRefreshAllServers,
  createRefreshOrStartServer,
  createRuntimeOptions,
  createStartServer,
  logoutServer,
  refreshServer,
  stopServer,
} from './lifecycle'
import {
  authenticatingServers,
  loadingServers,
  personalMcp,
  projectMcp,
  serverStates,
} from './state'

const useMcpServers = () => {
  const config = useVixlConfig()
  const runtimeOptions = createRuntimeOptions(config)
  const assertTrustedOrThrow = createAssertTrustedOrThrow(config)
  const startServer = createStartServer(assertTrustedOrThrow, runtimeOptions)
  const refreshOrStartServer = createRefreshOrStartServer(startServer)
  const refreshAllServers = createRefreshAllServers(refreshOrStartServer)
  const authenticateServer = createAuthenticateServer(
    assertTrustedOrThrow,
    runtimeOptions,
  )
  const setServerEnabled = createSetServerEnabled(
    assertTrustedOrThrow,
    startServer,
  )

  return {
    personalMcp,
    projectMcp,
    serverStates,
    loadingServers,
    authenticatingServers,
    loadConfigs,
    refreshStates,
    startServer,
    stopServer,
    refreshServer,
    refreshOrStartServer,
    refreshAllServers,
    authenticateServer,
    logoutServer,
    addServer,
    updateServer,
    upsertServer,
    deleteServer,
    setServerEnabled,
    listEffectiveMcpServers,
    listUserMcpServers,
    listScopedMcpServers,
  }
}

export default useMcpServers
