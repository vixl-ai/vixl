import type { LspActivity, LspPhase } from '@/services/vixl/vixl-tauri/types'

export type { LspActivity, LspPhase }

export type LspServerDisplayState = LspPhase | 'disabled'

export type LspHealth = 'busy' | 'error' | 'warning' | 'ok'

export type LspStatusServerRow = {
  id: string
  label: string
  extensions: string[]
  installKind: string
  requiresTrust: boolean
  installable: boolean
  installed: boolean
  disabled: boolean
  canDisable: boolean
  phase: LspPhase
  generation: number
  revision: number
  phaseSinceMs: number
  message: string | null
  error: string | null
  activity: LspActivity | null
  source: string | null
  workspaceRoot: string | null
  pid: number | null
  running: boolean
  displayState: LspServerDisplayState
}

export type LspProblemItem = {
  id: string
  uri: string
  path: string
  message: string
  severity: 'error' | 'warning'
  line: number
  character: number
}
