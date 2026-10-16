export type CodebaseToolSpan = {
  path: string
  startLine: number
  endLine: number
  symbol?: string
  snippet?: string
}

export type CodebaseToolResult = {
  summary?: string
  results: CodebaseToolSpan[]
  repo?: string
}

export type CodebaseImpactEdge = {
  from: string
  to: string
  kind?: string
}

export type CodebaseImpactResult = {
  summary?: string
  results: CodebaseToolSpan[]
  edges?: CodebaseImpactEdge[]
  repo?: string
}

export type CodebaseStatusResult = {
  ready: boolean
  indexing: boolean
  syncing: boolean
  repo?: string
  error?: string
  detail?: string
  pendingFiles?: string[]
  filesIndexed?: number
  totalNodes?: number
  totalEdges?: number
  databaseSize?: string
  backend?: string
  languages?: string[]
}
