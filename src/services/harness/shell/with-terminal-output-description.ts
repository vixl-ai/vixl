import { getAgentShell } from '@/services/harness/shell/registry'

export const withTerminalOutputDescription = (name: string, args: unknown): unknown => {
  if (name !== 'terminal_output') {
    return args
  }
  if (!args || typeof args !== 'object') {
    return args
  }

  const record = args as Record<string, unknown>
  const existing = record.description
  if (typeof existing === 'string' && existing.length > 0) {
    return args
  }

  const shellId = record.shell_id
  if (typeof shellId !== 'string' || shellId.length === 0) {
    return args
  }

  const description = getAgentShell(shellId)?.description
  if (typeof description !== 'string' || description.length === 0) {
    return args
  }

  return { ...record, description }
}
