import type { ChatArtifact } from '@/types/chat/chat-artifact'

const CODEBASE_SPAN_TOOLS = new Set([
  'codebase_explore',
  'codebase_search',
  'codebase_impact',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object'

const fileArtifact = (
  path: string | undefined,
  options?: { label?: string; startLine?: number; endLine?: number },
): ChatArtifact | undefined => {
  if (!path) {
    return undefined
  }
  const artifact: ChatArtifact = { kind: 'file', path }
  if (options?.label) {
    artifact.label = options.label
  }
  if (typeof options?.startLine === 'number' && options.startLine >= 1) {
    artifact.startLine = Math.trunc(options.startLine)
  }
  if (typeof options?.endLine === 'number' && options.endLine >= 1) {
    artifact.endLine = Math.trunc(options.endLine)
  }
  return artifact
}

const pathFromResultOrArgs = (
  result: Record<string, unknown>,
  args: unknown,
  resultKey = 'path',
  argsKey = 'path',
): string | undefined => {
  if (typeof result[resultKey] === 'string') {
    return result[resultKey] as string
  }
  if (isRecord(args) && typeof args[argsKey] === 'string') {
    return args[argsKey] as string
  }
  return undefined
}

const lineSuffix = (startLine?: number, endLine?: number): string => {
  if (typeof startLine !== 'number' || startLine < 1) {
    return ''
  }
  if (typeof endLine === 'number' && endLine > startLine) {
    return `:${startLine}-${endLine}`
  }
  return `:${startLine}`
}

const artifactFromCodebaseSpan = (
  entry: Record<string, unknown>,
): ChatArtifact | undefined => {
  if (typeof entry.path !== 'string' || entry.path.length === 0) {
    return undefined
  }
  const startLine =
    typeof entry.startLine === 'number' && Number.isFinite(entry.startLine)
      ? Math.max(1, Math.trunc(entry.startLine))
      : undefined
  const endLine =
    typeof entry.endLine === 'number' && Number.isFinite(entry.endLine)
      ? Math.max(1, Math.trunc(entry.endLine))
      : startLine
  const fileName = entry.path.split('/').pop() ?? entry.path
  const suffix = lineSuffix(startLine, endLine)
  const symbol =
    typeof entry.symbol === 'string' && entry.symbol.length > 0
      ? entry.symbol
      : undefined
  const label = symbol
    ? `${symbol} (${fileName}${suffix})`
    : `${fileName}${suffix}`
  return fileArtifact(entry.path, { label, startLine, endLine })
}

export default (
  name: string,
  result: unknown,
  args?: unknown,
  isError = false,
): ChatArtifact | undefined => {
  if (isError) {
    return undefined
  }
  if (!isRecord(result)) {
    return undefined
  }
  if (result.rejected === true) {
    return undefined
  }
  if ('error' in result && result.error) {
    return undefined
  }

  if (name === 'create_plan') {
    const path = typeof result.path === 'string' ? result.path : undefined
    if (!path) {
      return undefined
    }
    const label =
      isRecord(args) && typeof args.title === 'string' ? args.title : undefined
    const id = typeof result.planId === 'string' ? result.planId : undefined
    return { kind: 'plan', path, label, ...(id ? { id } : {}) }
  }

  if (
    name === 'write_file' ||
    name === 'edit_file' ||
    name === 'read_file' ||
    name === 'delete_file'
  ) {
    return fileArtifact(pathFromResultOrArgs(result, args))
  }

  if (name === 'move_file') {
    return fileArtifact(pathFromResultOrArgs(result, args, 'to', 'to'))
  }

  if (name === 'apply_patch') {
    if (Array.isArray(result.paths)) {
      const first = result.paths.find(
        (entry): entry is string => typeof entry === 'string' && entry.length > 0,
      )
      if (first) {
        return fileArtifact(first)
      }
    }
    if (Array.isArray(result.diffs)) {
      for (const entry of result.diffs) {
        if (isRecord(entry) && typeof entry.path === 'string') {
          return fileArtifact(entry.path)
        }
      }
    }
    return undefined
  }

  if (CODEBASE_SPAN_TOOLS.has(name) && Array.isArray(result.results)) {
    for (const entry of result.results) {
      if (!isRecord(entry)) {
        continue
      }
      const artifact = artifactFromCodebaseSpan(entry)
      if (artifact) {
        return artifact
      }
    }
    return undefined
  }

  return undefined
}
