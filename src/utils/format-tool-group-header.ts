import type { ToolRun } from '@/types/harness/tool-run'

export default (tools: ToolRun[]): string => {
  const running = tools.some((tool) => tool.status === 'running')
  if (running) {
    return `Using ${tools.length} tools`
  }
  return `Used ${tools.length} tools`
}
