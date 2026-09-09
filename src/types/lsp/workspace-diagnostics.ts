export type LspWorkspaceDiagnosticMode = 'workspace' | 'open_documents' | 'unavailable'

export type LspDiagnostic = {
  message: string
  severity?: number
  range?: {
    start: {
      line: number
      character: number
    }
  }
}

export type LspWorkspaceDiagnosticFile = {
  uri: string
  path: string
  diagnostics: unknown
}

export type LspWorkspaceDiagnosticsServer = {
  id: string
  mode: LspWorkspaceDiagnosticMode
  error: string | null
  items: LspWorkspaceDiagnosticFile[]
  installState?: string | null
}

export type LspWorkspaceDiagnosticsResult = {
  servers: LspWorkspaceDiagnosticsServer[]
}

export type LspWorkspaceIssueItem = {
  path: string
  severity: 'error' | 'warning'
  message: string
  line: number
  character: number
  serverId: string
}

export type LspWorkspaceIssuesServer = {
  id: string
  mode: LspWorkspaceDiagnosticMode
  error?: string
  installState?: string | null
}

export type LspWorkspaceIssuesResult = {
  scope: 'workspace'
  errorCount: number
  warningCount: number
  itemCap: number
  truncated: boolean
  items: LspWorkspaceIssueItem[]
  servers: LspWorkspaceIssuesServer[]
  error?: string
}
