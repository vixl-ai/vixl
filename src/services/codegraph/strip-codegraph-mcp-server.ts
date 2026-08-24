import type { McpConfig } from '@/types/vixl/mcp-config'
import { CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'

/** Remove the reserved internal CodeGraph id from persisted MCP config. */
export default (config: McpConfig): McpConfig => {
  if (!(CODEGRAPH_SERVER_ID in config.servers)) {
    return config
  }
  const servers = { ...config.servers }
  delete servers[CODEGRAPH_SERVER_ID]
  return {
    ...config,
    servers,
  }
}
