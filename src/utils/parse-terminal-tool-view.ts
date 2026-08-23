import type { ToolRun } from '@/types/harness/tool-run'
import { clipTerminalLabel } from '@/utils/clip-terminal-label'

export const TERMINAL_TOOL_NAMES = new Set(['run_terminal', 'terminal_output', 'stop_terminal'])

export const isTerminalToolName = (name: string): boolean => TERMINAL_TOOL_NAMES.has(name)

export type TerminalToolPhaseView = {
  sandboxed?: boolean
  exitCode?: number
  output: string
  title: string
  badge?: 'sandboxed' | 'unsandboxed'
}

export type TerminalToolView = {
  command: string
  label: string
  shellId?: string
  phases: TerminalToolPhaseView[]
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined

const asExitCode = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value)
  }
  return undefined
}

const asSandboxed = (record: Record<string, unknown> | null): boolean | undefined => {
  if (!record || typeof record.sandboxed !== 'boolean') {
    return undefined
  }
  return record.sandboxed
}

export const stripSandboxingFooter = (text: string): string => {
  const nested = text.indexOf('\nSANDBOXING:')
  if (nested >= 0) {
    return text.slice(0, nested).trimEnd()
  }
  if (text.startsWith('SANDBOXING:')) {
    return ''
  }
  return text
}

const phaseTitle = (sandboxed?: boolean): string => {
  if (sandboxed === false) {
    return 'Unsandboxed'
  }
  if (sandboxed === true) {
    return 'Sandboxed'
  }
  return 'Terminal'
}

const phaseBadge = (sandboxed?: boolean): 'sandboxed' | 'unsandboxed' | undefined => {
  if (sandboxed === true) {
    return 'sandboxed'
  }
  if (sandboxed === false) {
    return 'unsandboxed'
  }
  return undefined
}

const combinePhaseOutput = (record: Record<string, unknown> | null): string => {
  if (!record) {
    return ''
  }
  const stdout = asOptionalString(record.stdout) ?? ''
  const stderr = asOptionalString(record.stderr) ?? ''
  const error = stripSandboxingFooter(asOptionalString(record.error) ?? '')
  return [stdout, stderr, error].filter((part) => part.length > 0).join('\n')
}

const parsePhase = (record: Record<string, unknown> | null): TerminalToolPhaseView | null => {
  if (!record) {
    return null
  }
  const sandboxed = asSandboxed(record)
  const exitCode = asExitCode(record.exitCode)
  const output = combinePhaseOutput(record)
  if (sandboxed === undefined && exitCode === undefined && output.length === 0) {
    return null
  }
  const phase: TerminalToolPhaseView = {
    output,
    title: phaseTitle(sandboxed),
  }
  if (sandboxed !== undefined) {
    phase.sandboxed = sandboxed
  }
  if (exitCode !== undefined) {
    phase.exitCode = exitCode
  }
  const badge = phaseBadge(sandboxed)
  if (badge) {
    phase.badge = badge
  }
  return phase
}

export const parseTerminalToolView = (run: ToolRun): TerminalToolView | null => {
  if (!isTerminalToolName(run.name)) {
    return null
  }

  const args = asRecord(run.args)
  const result = asRecord(run.result)
  const command = asOptionalString(result?.command) ?? asOptionalString(args?.command) ?? ''
  const label = clipTerminalLabel(
    asOptionalString(result?.description) ?? asOptionalString(args?.description) ?? '',
  )
  const shellId = asOptionalString(result?.shellId) ?? asOptionalString(args?.shell_id)
  const phases: TerminalToolPhaseView[] = []
  const prior = parsePhase(asRecord(result?.priorPhase))
  if (prior) {
    phases.push(prior)
  }
  const current = parsePhase(result)
  if (current) {
    phases.push(current)
  } else if (phases.length === 0 && run.status === 'running') {
    phases.push({
      output: '',
      title: 'Terminal',
    })
  } else if (phases.length === 0 && typeof run.result === 'string') {
    phases.push({
      output: stripSandboxingFooter(run.result),
      title: 'Terminal',
    })
  }

  return {
    command,
    label,
    shellId,
    phases,
  }
}
