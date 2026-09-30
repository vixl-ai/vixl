import type * as monaco from 'monaco-editor'
import {
  isRecord,
  readRange,
  type LspCompletionItem,
  type LspLocationLink,
  type LspMarkedString,
} from './types'
import { lspRangeToMonaco } from './diagnostics'

const readMarkedString = (value: LspMarkedString): string => {
  if (typeof value === 'string') {
    return value
  }
  return value.value
}

const readMarkupContent = (value: unknown): string | null => {
  if (!isRecord(value) || typeof value.value !== 'string') {
    return null
  }
  return value.value
}

export const parseLspHoverContents = (result: unknown): string[] => {
  if (!isRecord(result)) {
    return []
  }

  const { contents } = result
  if (typeof contents === 'string') {
    return [contents]
  }

  const markup = readMarkupContent(contents)
  if (markup) {
    return [markup]
  }

  if (Array.isArray(contents)) {
    return contents
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }
        if (isRecord(item) && typeof item.value === 'string') {
          return item.value
        }
        return null
      })
      .filter((item): item is string => item !== null)
  }

  if (isRecord(contents) && typeof contents.value === 'string') {
    return [readMarkedString(contents as LspMarkedString)]
  }

  return []
}

const lspCompletionKindToMonaco = (
  kind: number | undefined,
  monacoApi: typeof monaco,
): monaco.languages.CompletionItemKind => {
  const kinds = monacoApi.languages.CompletionItemKind
  switch (kind) {
    case 3:
      return kinds.Function
    case 4:
      return kinds.Constructor
    case 5:
      return kinds.Field
    case 6:
      return kinds.Variable
    case 7:
      return kinds.Class
    case 8:
      return kinds.Interface
    case 9:
      return kinds.Module
    case 10:
      return kinds.Property
    case 12:
      return kinds.Value
    case 13:
      return kinds.Enum
    case 14:
      return kinds.Keyword
    case 15:
      return kinds.Snippet
    case 17:
      return kinds.Constant
    case 21:
      return kinds.TypeParameter
    default:
      return kinds.Text
  }
}

const parseCompletionItem = (
  value: unknown,
  monacoApi: typeof monaco,
): monaco.languages.CompletionItem | null => {
  if (!isRecord(value) || typeof value.label !== 'string') {
    return null
  }

  const item = value as LspCompletionItem
  const suggestion = {
    label: item.label,
    kind: lspCompletionKindToMonaco(item.kind, monacoApi),
    detail: item.detail,
    insertText: item.insertText ?? item.label,
    sortText: item.sortText,
    filterText: item.filterText,
  } as monaco.languages.CompletionItem

  if (typeof item.documentation === 'string') {
    suggestion.documentation = item.documentation
  } else {
    const docs = readMarkupContent(item.documentation)
    if (docs) {
      suggestion.documentation = docs
    }
  }

  if (item.textEdit) {
    const range = readRange(item.textEdit.range)
    if (range) {
      suggestion.range = lspRangeToMonaco(range, monacoApi, range.start.line + 1)
      suggestion.insertText = item.textEdit.newText
    }
  }

  return suggestion
}

export const parseLspCompletionItems = (
  result: unknown,
  monacoApi: typeof monaco,
): monaco.languages.CompletionItem[] => {
  const items = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.items)
      ? result.items
      : []

  return items
    .map((item) => parseCompletionItem(item, monacoApi))
    .filter((item): item is monaco.languages.CompletionItem => item !== null)
}

export const parseLspLocations = (result: unknown): LspLocationLink[] => {
  const items = Array.isArray(result)
    ? result
    : isRecord(result) && Array.isArray(result.result)
      ? result.result
      : result
        ? [result]
        : []

  const locations: LspLocationLink[] = []
  for (const item of items) {
    if (!isRecord(item)) {
      continue
    }
    const uri =
      typeof item.uri === 'string'
        ? item.uri
        : typeof item.targetUri === 'string'
          ? item.targetUri
          : null
    const range =
      readRange(item.range) ??
      readRange(item.targetSelectionRange) ??
      readRange(item.targetRange)
    if (!uri || !range) {
      continue
    }
    locations.push({ uri, range })
  }
  return locations
}

export const parseLspTextEdits = (
  result: unknown,
): monaco.languages.TextEdit[] => {
  if (!Array.isArray(result)) {
    return []
  }

  const edits: monaco.languages.TextEdit[] = []
  for (const item of result) {
    if (!isRecord(item) || typeof item.newText !== 'string') {
      continue
    }
    const range = readRange(item.range)
    if (!range) {
      continue
    }
    edits.push({
      range: {
        startLineNumber: range.start.line + 1,
        startColumn: range.start.character + 1,
        endLineNumber: range.end.line + 1,
        endColumn: range.end.character + 1,
      },
      text: item.newText,
    })
  }
  return edits
}
