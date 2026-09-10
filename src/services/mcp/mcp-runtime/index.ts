import {
  authenticate,
  callTool,
  cancelAuthenticate,
  getPrompt,
  getStatus,
  listPrompts,
  listResources,
  listStatuses,
  readResource,
} from './operations'
import { logout, refresh, start, stop } from './lifecycle'

export type { McpRuntimeOptions } from './types'

const mcpRuntime = {
  start,
  stop,
  refresh,
  logout,
  authenticate,
  cancelAuthenticate,
  callTool,
  listStatuses,
  getStatus,
  listResources,
  readResource,
  listPrompts,
  getPrompt,
}

export default mcpRuntime
