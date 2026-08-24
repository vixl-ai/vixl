export const LSP_MARKER_OWNER = 'vixl-lsp'

export type LspPosition = {
  line: number
  character: number
}

export type LspRange = {
  start: LspPosition
  end: LspPosition
}

export type LspDiagnostic = {
  range?: LspRange
  severity?: number
  code?: string | number
  source?: string
  message: string
}

export type LspMarkedString = string | { language?: string; value: string }

export type LspMarkupContent = {
  kind: 'plaintext' | 'markdown'
  value: string
}

export type LspCompletionItem = {
  label: string
  kind?: number
  detail?: string
  documentation?: string | LspMarkupContent
  insertText?: string
  sortText?: string
  filterText?: string
  textEdit?: {
    range: LspRange
    newText: string
  }
}

export type LspLocationLink = {
  uri: string
  range: LspRange
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const readPosition = (value: unknown): LspPosition | null => {
  if (!isRecord(value)) {
    return null
  }
  const line = value.line
  const character = value.character
  if (typeof line !== 'number' || typeof character !== 'number') {
    return null
  }
  return { line, character }
}

export const readRange = (value: unknown): LspRange | null => {
  if (!isRecord(value)) {
    return null
  }
  const start = readPosition(value.start)
  const end = readPosition(value.end)
  if (!start || !end) {
    return null
  }
  return { start, end }
}
