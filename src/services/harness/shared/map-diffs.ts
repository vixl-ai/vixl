import type { FileDiffRecord } from '@/services/vixl/vixl-tauri'
import type { FileDiff } from '@/types/harness/file-diff'

const mapDiffs = (raw: FileDiffRecord[]): FileDiff[] =>
  raw.map((item) => ({
    path: item.path,
    operation: item.operation as FileDiff['operation'],
    oldContent: item.oldContent,
    newContent: item.newContent,
    hunks: item.hunks.map((hunk) => ({
      oldStart: hunk.oldStart,
      newStart: hunk.newStart,
      lines: hunk.lines.map((line) => ({
        kind: line.kind as FileDiff['hunks'][number]['lines'][number]['kind'],
        content: line.content,
      })),
    })),
  }))

export default mapDiffs
