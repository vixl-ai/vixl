import type { AgentShellRecord } from '@/types/harness/agent-shell'

export const shellDisplayTitle = (
  shell: Pick<AgentShellRecord, 'description' | 'command'>,
): string => {
  const description = shell.description?.trim()
  if (description) {
    return description
  }
  return shell.command
}
