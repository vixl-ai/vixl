import { parseLspDiagnosticItems } from '@/services/harness/lsp/parse-diagnostics'
import type {
  LspWorkspaceDiagnosticsResult,
  LspWorkspaceIssueItem,
  LspWorkspaceIssuesResult,
  LspWorkspaceIssuesServer,
} from '@/types/lsp'

const ITEM_CAP = 50

const readStartPosition = (
  value: unknown,
): { line: number; character: number } => {
  if (!value || typeof value !== 'object') {
    return { line: 0, character: 0 }
  }
  const range = value as Record<string, unknown>
  const start = range.start
  if (!start || typeof start !== 'object') {
    return { line: 0, character: 0 }
  }
  const position = start as Record<string, unknown>
  return {
    line: typeof position.line === 'number' ? position.line : 0,
    character: typeof position.character === 'number' ? position.character : 0,
  }
}

const toIssue = (
  value: unknown,
  path: string,
  serverId: string,
): LspWorkspaceIssueItem | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  const diagnostic = value as Record<string, unknown>
  if (typeof diagnostic.message !== 'string') {
    return null
  }
  const severityNumber =
    typeof diagnostic.severity === 'number' ? diagnostic.severity : 2
  if (severityNumber !== 1 && severityNumber !== 2) {
    return null
  }
  const start = readStartPosition(diagnostic.range)
  return {
    path,
    severity: severityNumber === 1 ? 'error' : 'warning',
    message: diagnostic.message,
    line: start.line,
    character: start.character,
    serverId,
  }
}

const toServerSummary = (
  server: LspWorkspaceDiagnosticsResult['servers'][number],
): LspWorkspaceIssuesServer => {
  const summary: LspWorkspaceIssuesServer = {
    id: server.id,
    mode: server.mode,
  }
  if (server.error) {
    summary.error = server.error
  }
  if (server.installState !== undefined && server.installState !== null) {
    summary.installState = server.installState
  }
  return summary
}

// Rust returns { servers: [] } when the warm plan finds no language servers.
// That is a successful empty report, not a workspace scan, so treat it as unavailable.
const deriveScope = (
  servers: LspWorkspaceDiagnosticsResult['servers'],
): LspWorkspaceIssuesResult['scope'] => {
  if (servers.length === 0) {
    return 'unavailable'
  }
  const first = servers[0]!.mode
  for (const server of servers) {
    if (server.mode !== first) {
      return 'mixed'
    }
  }
  return first
}

const summarizeWorkspace = (
  result: LspWorkspaceDiagnosticsResult,
): LspWorkspaceIssuesResult => {
  const errors: LspWorkspaceIssueItem[] = []
  const warnings: LspWorkspaceIssueItem[] = []

  for (const server of result.servers) {
    for (const file of server.items) {
      for (const diagnostic of parseLspDiagnosticItems(file.diagnostics)) {
        const issue = toIssue(diagnostic, file.path, server.id)
        if (!issue) {
          continue
        }
        if (issue.severity === 'error') {
          errors.push(issue)
        } else {
          warnings.push(issue)
        }
      }
    }
  }

  const ranked = [...errors, ...warnings]
  return {
    scope: deriveScope(result.servers),
    errorCount: errors.length,
    warningCount: warnings.length,
    itemCap: ITEM_CAP,
    truncated: ranked.length > ITEM_CAP,
    items: ranked.slice(0, ITEM_CAP),
    servers: result.servers.map(toServerSummary),
  }
}

export default summarizeWorkspace
