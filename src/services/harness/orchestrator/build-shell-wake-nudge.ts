import { visibleStatus } from '@/services/harness/guidance'
import type { ShellWakeResult } from '@/types/harness/agent-shell'

type RunningShell = {
  shellId: string
  description?: string
  command: string
}

const shellLabel = (item: { description?: string; command: string }): string => {
  const description = item.description?.trim()
  return description ? description : item.command
}

const finishedEntry = (item: ShellWakeResult): string => {
  const signalSuffix = typeof item.signal === 'number' ? ` signal ${item.signal}` : ''
  return [
    `- ${shellLabel(item)} (${item.shellId}) exit ${item.exitCode}${signalSuffix}`,
    'stdout:',
    item.stdout,
    'stderr:',
    item.stderr,
  ].join('\n')
}

export default (
  finished: ShellWakeResult[],
  running: RunningShell[],
): string => {
  const body =
    running.length === 0
      ? `All background terminals have finished. Answer the user from those results. ${visibleStatus('finished')}`
      : `A background terminal finished. Still running: ${running
          .map((shell) => `${shellLabel(shell)} (${shell.shellId})`)
          .join(', ')}. Either answer about the finished result now or wait for the rest. ${visibleStatus('finished')}`

  return [
    '[harness: background terminal results]',
    'Sent by the vixl harness, not a new user request.',
    '',
    body,
    '',
    'Finished:',
    finished.map(finishedEntry).join('\n\n'),
  ].join('\n')
}
