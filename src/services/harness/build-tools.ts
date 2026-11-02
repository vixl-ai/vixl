import buildHarnessTools from '@/services/harness/build-harness-tools'
import { resolveModels } from '@/services/harness/models'
import {
  getSubagent,
  getSubagents,
  spawnSubagent,
  steerSubagent,
  SUBAGENT_MCP_TOOLS,
} from '@/services/harness/subagent'
import type { HarnessToolContext } from '@/types/harness/tool-context'

export type { HarnessToolContext } from '@/types/harness/tool-context'
export { SUBAGENT_MCP_TOOLS }

const buildTools = (ctx: HarnessToolContext) => ({
  ...buildHarnessTools(ctx),
  resolve_models: resolveModels(ctx),
  spawn_subagent: spawnSubagent(ctx),
  steer_subagent: steerSubagent(ctx),
  get_subagents: getSubagents(ctx),
  get_subagent: getSubagent(ctx),
})

export default buildTools
