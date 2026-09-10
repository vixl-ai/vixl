import { toast } from 'vue-sonner'
import type { McpServerConfig } from '@/types/vixl/mcp-config'
import { isMcpHttpServer } from '@/types/vixl/mcp-config'
import mcpRuntime, { type McpRuntimeOptions } from '@/services/mcp/mcp-runtime'
import connectionKey from '@/services/mcp/connection-key'
import {
  patchPendingMcpAuthForServer,
  resolveMcpAuthForServer,
} from '@/services/mcp/mcp-auth-gate'
import { getHttpOauthChallenge } from '@/services/mcp/mcp-http-client'
import { getLastOAuthChallenge, isDcrMissingClientError } from '@/services/mcp/oauth'
import { patchServerState, withServerLoading } from './helpers'
import { authenticatingServers } from './state'
import createAssertTrustedOrThrow from './create-assert-trusted-or-throw'
import createRuntimeOptions from './create-runtime-options'

const createAuthenticateServer = (
  assertTrustedOrThrow: ReturnType<typeof createAssertTrustedOrThrow>,
  runtimeOptions: ReturnType<typeof createRuntimeOptions>,
) => async (
  serverId: string,
  serverConfig: McpServerConfig,
  extras?: Pick<
    McpRuntimeOptions,
    'confirmAuthorizationServerOrigin' | 'settings' | 'scopeKey'
  >,
): Promise<void> => {
  const authKey = connectionKey(extras?.scopeKey, serverId)
  authenticatingServers.value = {
    ...authenticatingServers.value,
    [authKey]: true,
  }
  await withServerLoading(serverId, async () => {
    try {
      assertTrustedOrThrow(serverId, serverConfig, extras?.settings, extras?.scopeKey)
      const stored = getHttpOauthChallenge(serverId, extras?.scopeKey)
      const fromUrl = isMcpHttpServer(serverConfig)
        ? getLastOAuthChallenge(serverConfig.url)
        : undefined
      const challenge = stored ?? fromUrl
      const state = await mcpRuntime.authenticate(
        serverId,
        serverConfig,
        runtimeOptions({
          ...extras,
          scope: challenge?.scope,
          resourceMetadataUrl: challenge?.resourceMetadataUrl,
        }),
      )
      patchServerState(serverId, state, extras?.scopeKey)
      resolveMcpAuthForServer(serverId, { action: 'authenticated' }, extras?.scopeKey)
      toast.success(`${serverId} authenticated`)
    } catch (error) {
      if (error instanceof Error && error.message === 'OAuth callback aborted') {
        throw error
      }
      patchServerState(serverId, {
        serverId,
        status: 'auth_required',
        tools: [],
        error: error instanceof Error ? error.message : String(error),
      }, extras?.scopeKey)
      if (isDcrMissingClientError(error)) {
        patchPendingMcpAuthForServer(
          serverId,
          {
            kind: 'client',
            detail:
              'This authorization server needs a client ID. Enter the client ID from the server. Optional client secret is stored in the keychain only.',
          },
          extras?.scopeKey,
        )
      }
      toast.error('Authentication failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      throw error
    } finally {
      authenticatingServers.value = {
        ...authenticatingServers.value,
        [authKey]: false,
      }
    }
  }, extras?.scopeKey)
}

export default createAuthenticateServer
