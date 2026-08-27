import type { PrefixSnapshot } from '@/types/harness/prefix-snapshot'
import type { McpIcon } from '@/types/mcp/mcp-icon'

export type ConfigScope = 'personal' | 'project'

export type OAuthLoopbackStart = {
  port: number
  redirectUrl: string
}

export type FleetProjectRecord = {
  id: string
  name: string
  slug: string
  rootPath: string
  lastOpened: string
}

export type ProjectFileEntry = {
  name: string
  path: string
  description?: string | null
}

export type VixlFilesKind = 'agents' | 'rules' | 'skills' | 'plans' | 'studio'

export type McpToolInfo = {
  name: string
  description?: string | null
  inputSchema?: Record<string, unknown> | null
  meta?: Record<string, unknown> | null
}

export type McpServerState = {
  serverId: string
  status: string
  error?: string | null
  tools: McpToolInfo[]
  icons?: McpIcon[] | null
}

export type HttpProxyRequest = {
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
  requestId?: string
}

export type WebFetchFormat = 'markdown' | 'text' | 'html'

export type WebFetchRequest = {
  url: string
  format?: WebFetchFormat
}

export type WebFetchResponse = {
  status: number
  body: string
  headers: Record<string, string>
}

export type ChatMetaRecord = {
  id: string
  title: string
  projectSlug: string
  projectRoot: string
  mode: string
  model: string
  status: 'idle' | 'running'
  attention?:
    | 'needs_approval'
    | 'needs_input'
    | 'needs_mcp_auth'
    | 'completed'
    | 'error'
    | null

  createdAt: string
  updatedAt: string
  forkedFrom: string | null
  pinned: boolean
  pinnedAt: string | null
  prefixSnapshot?: PrefixSnapshot
  activeContext?: {
    checkpointLineId?: string
    includeFromCreatedAt?: string
    summary?: string
  }
  awaitingPlanGo?: {
    planPath: string
    planId: string
  } | null
  subagentModel?: string | null
  reasoning?: string | null
  subagentReasoning?: string | null
  usageTotals?: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    costUSD: number | null
    pricingComplete: boolean
  }
}

export type FsEditReplacement = {
  oldString: string
  newString: string
  replaceAll?: boolean
}

export type FileDiffRecord = {
  path: string
  operation: string
  oldContent?: string
  newContent?: string
  hunks: Array<{
    oldStart: number
    newStart: number
    lines: Array<{ kind: string; content: string }>
  }>
}

export type GrepMatch = {
  path: string
  lineNumber: number
  line: string
  contextBefore?: string[]
  contextAfter?: string[]
  /** 1-based character column from rg submatch byte start. */
  startColumn?: number
  /** 1-based character column from rg submatch byte end (exclusive). */
  endColumn?: number
}

export type WorkspaceGrepResult = {
  matches: GrepMatch[]
  truncated: boolean
}

export type GlobFileEntry = {
  path: string
  modifiedMs?: number
}

export type WorkspaceGlobResult = {
  files: GlobFileEntry[]
  truncated: boolean
}

export type GitCommitResult = {
  hash: string
  message: string
  output: string
}

export type CodegraphCliResult = {
  ok: boolean
  stdout: string
  stderr: string
  exitCode?: number | null
}

export type LspServerStatus = {
  id: string
  running: boolean
  error?: string | null
  source?: string | null
  installState?: string | null
}

export type LspWorkspaceProfile = {
  vueNuxt: boolean
  warm: string[]
  warmExtensions: string[]
}

export type LspCatalogEntry = {
  id: string
  label: string
  extensions: string[]
  installKind: string
  requiresTrust: boolean
  installable: boolean
  installed: boolean
  running: boolean
  disabled: boolean
  error?: string | null
  source?: string | null
  installState?: string | null
}
