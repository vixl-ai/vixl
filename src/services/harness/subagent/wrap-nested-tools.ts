import capToolOutput from '@/services/harness/subagent/cap-tool-output'

type NestedTool = {
  execute?: (...args: never[]) => unknown | Promise<unknown>
} & Record<string, unknown>

const wrapNestedTools = (
  tools: Record<string, NestedTool>,
): Record<string, NestedTool> => {
  const wrapped: Record<string, NestedTool> = {}
  for (const [name, toolDef] of Object.entries(tools)) {
    const { execute } = toolDef
    if (typeof execute !== 'function') {
      wrapped[name] = toolDef
      continue
    }
    wrapped[name] = {
      ...toolDef,
      execute: async (...args: never[]) => capToolOutput(await execute(...args)),
    }
  }
  return wrapped
}

export default wrapNestedTools
