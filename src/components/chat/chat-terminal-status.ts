import type { TerminalToolPhaseView } from '@/utils/parse-terminal-tool-view'

export type TerminalPhaseStatusKind = 'running' | 'ok' | 'fail' | 'idle'

export const terminalPhaseStatusKind = (args: {
  phase: TerminalToolPhaseView
  isLast: boolean
  isRunning: boolean
  isError: boolean
}): TerminalPhaseStatusKind => {
  if (args.isLast && args.isRunning) {
    return 'running'
  }
  if (
    (args.isLast && args.isError) ||
    (typeof args.phase.exitCode === 'number' && args.phase.exitCode !== 0)
  ) {
    return 'fail'
  }
  if (typeof args.phase.exitCode === 'number' && args.phase.exitCode === 0) {
    return 'ok'
  }
  return 'idle'
}

export const terminalPhaseStatusTooltip = (
  kind: TerminalPhaseStatusKind,
  exitCode?: number,
): string => {
  if (kind === 'running') {
    return 'Running'
  }
  if (kind === 'ok') {
    return 'Exit 0'
  }
  if (kind === 'fail') {
    return typeof exitCode === 'number' ? `Exit ${exitCode}` : 'Failed'
  }
  return 'Terminal'
}

export const terminalPhaseStatusColorClass = (kind: TerminalPhaseStatusKind): string => {
  if (kind === 'running') {
    return 'shrink-0 animate-spin text-amber-400'
  }
  if (kind === 'ok') {
    return 'shrink-0 text-emerald-400'
  }
  if (kind === 'fail') {
    return 'shrink-0 text-red-400'
  }
  return 'shrink-0 text-zinc-400'
}
