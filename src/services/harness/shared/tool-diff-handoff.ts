import type { FileDiff } from '@/types/harness/file-diff'

const MAX_TRACKED_TOOL_DIFFS = 512

const pending = new Map<string, FileDiff[]>()

const recordToolDiff = (toolCallId: string, diffs: FileDiff[]): void => {
  if (
    !pending.has(toolCallId) &&
    pending.size >= MAX_TRACKED_TOOL_DIFFS
  ) {
    const oldest = pending.keys().next()
    if (!oldest.done) {
      pending.delete(oldest.value)
    }
  }
  pending.set(toolCallId, diffs)
}

const takeToolDiff = (toolCallId: string): FileDiff[] | undefined => {
  const diffs = pending.get(toolCallId)
  if (diffs === undefined) {
    return undefined
  }
  pending.delete(toolCallId)
  return diffs
}

const discardToolDiff = (toolCallId: string): void => {
  pending.delete(toolCallId)
}

const countContentLines = (content: string): number => {
  if (!content) {
    return 0
  }
  const lines = content.split('\n')
  return lines.at(-1) === '' ? lines.length - 1 : lines.length
}

const diffCounts = (
  diffs: FileDiff[],
): { added: number; removed: number } => {
  let added = 0
  let removed = 0
  for (const diff of diffs) {
    if (diff.hunks.length === 0) {
      added += countContentLines(diff.newContent ?? '')
      removed += countContentLines(diff.oldContent ?? '')
      continue
    }
    for (const hunk of diff.hunks) {
      for (const line of hunk.lines) {
        if (line.kind === 'add') {
          added++
        } else if (line.kind === 'remove') {
          removed++
        }
      }
    }
  }
  return { added, removed }
}

export { recordToolDiff, takeToolDiff, discardToolDiff, diffCounts }
