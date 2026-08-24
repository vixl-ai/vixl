import type { McpConfig, McpInputDefinition, McpServerConfig } from '@/types/vixl/mcp-config'
import { isMcpHttpServer, isMcpStdioServer } from '@/types/vixl/mcp-config'
import { mcpInputKey } from '@/services/mcp/mcp-keychain-keys'
import {
  collectRecordInputIds,
  collectMcpTemplateInputIds,
  substituteMcpRecord,
  substituteMcpTemplate,
  type McpTemplateContext,
} from '@/services/mcp/substitute-mcp-templates'
import { deleteSecret, getSecret, setSecret } from '@/services/vixl/vixl-tauri'

export type MissingMcpInput = McpInputDefinition & {
  serverId: string
}

const findInputDefinition = (
  config: McpConfig,
  inputId: string,
): McpInputDefinition => {
  const fromConfig = config.inputs?.find((item) => item.id === inputId)
  if (fromConfig) {
    return fromConfig
  }
  return {
    id: inputId,
    type: 'promptString',
    description: `Value for ${inputId}`,
    password: true,
  }
}

export const listRequiredInputIdsForServer = (
  serverConfig: McpServerConfig,
): string[] => {
  const ids: string[] = []
  if (isMcpStdioServer(serverConfig)) {
    ids.push(...collectRecordInputIds(serverConfig.env))
    for (const arg of serverConfig.args ?? []) {
      ids.push(...collectMcpTemplateInputIds(arg))
    }
  }
  if (isMcpHttpServer(serverConfig)) {
    ids.push(...collectRecordInputIds(serverConfig.headers))
  }
  return [...new Set(ids)]
}

export const loadMcpInputValues = async (
  serverId: string,
  inputIds: string[],
): Promise<{ values: Record<string, string>; missing: string[] }> => {
  const values: Record<string, string> = {}
  const missing: string[] = []
  for (const inputId of inputIds) {
    const stored = await getSecret(mcpInputKey(serverId, inputId))
    if (stored === null || stored.length === 0) {
      missing.push(inputId)
      continue
    }
    values[inputId] = stored
  }
  return { values, missing }
}

export const saveMcpInputValues = async (
  serverId: string,
  values: Record<string, string>,
): Promise<void> => {
  for (const [inputId, value] of Object.entries(values)) {
    await setSecret(mcpInputKey(serverId, inputId), value)
  }
}

export const clearMcpInputValues = async (
  serverId: string,
  inputIds: string[],
): Promise<void> => {
  for (const inputId of inputIds) {
    await deleteSecret(mcpInputKey(serverId, inputId))
  }
}

export const listMissingInputsForServer = async (
  config: McpConfig,
  serverId: string,
  serverConfig: McpServerConfig,
): Promise<MissingMcpInput[]> => {
  const required = listRequiredInputIdsForServer(serverConfig)
  const { missing } = await loadMcpInputValues(serverId, required)
  return missing.map((inputId) => ({
    serverId,
    ...findInputDefinition(config, inputId),
  }))
}

export const resolveServerTemplates = async (
  serverId: string,
  serverConfig: McpServerConfig,
  env: Record<string, string> = {},
): Promise<{
  headers?: Record<string, string>
  args?: string[]
  serverEnv?: Record<string, string>
}> => {
  const required = listRequiredInputIdsForServer(serverConfig)
  const { values, missing } = await loadMcpInputValues(serverId, required)
  if (missing.length > 0) {
    throw new Error(`Missing MCP inputs: ${missing.join(', ')}`)
  }

  const context: McpTemplateContext = { inputs: values, env }

  if (isMcpHttpServer(serverConfig)) {
    return {
      headers: substituteMcpRecord(serverConfig.headers, context),
    }
  }

  return {
    args: (serverConfig.args ?? []).map((arg) => substituteMcpTemplate(arg, context)),
    serverEnv: substituteMcpRecord(serverConfig.env, context),
  }
}
