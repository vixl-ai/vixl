import countDiffLines from '@/utils/count-diff-lines'
import resolveFileDiffHunks from '@/utils/resolve-file-diff-hunks'
import { fileCheckpointRestore } from '@/services/vixl/vixl-tauri'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type { ChatTimelineItem } from '@/types/chat/chat-timeline-item'
import type { FileDiff } from '@/types/harness/file-diff'
import type {
  AggregatedTurnFileChange,
  FileCheckpointRestoreResult,
  FileCheckpointRestoreTarget,
} from '@/types/harness/file-checkpoint'

const operationPriority: Record<AggregatedTurnFileChange['operation'], number> = {
  create: 0,
  update: 1,
  rename: 2,
  delete: 3,
}

export const aggregateTurnFileDiffs = (
  turn: AgentTurn,
): AggregatedTurnFileChange[] => {
  const byPath = new Map<string, AggregatedTurnFileChange>()

  for (const step of turn.steps) {
    for (const tool of step.tools) {
      if (tool.status !== 'done' || !tool.diffs?.length) {
        continue
      }
      for (const diff of tool.diffs) {
        mergeDiff(byPath, diff)
      }
    }
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

const mergeDiff = (
  byPath: Map<string, AggregatedTurnFileChange>,
  diff: FileDiff,
): void => {
  const counts = countDiffLines(resolveFileDiffHunks(diff))
  const existing = byPath.get(diff.path)
  if (!existing) {
    byPath.set(diff.path, {
      path: diff.path,
      operation: diff.operation,
      additions: counts.additions,
      deletions: counts.deletions,
    })
    return
  }
  existing.additions += counts.additions
  existing.deletions += counts.deletions
  if (operationPriority[diff.operation] > operationPriority[existing.operation]) {
    existing.operation = diff.operation
  }
}

export const collectMutationsAfterUserMessage = (
  timeline: ChatTimelineItem[],
  messageId: string,
): AggregatedTurnFileChange[] => {
  const index = timeline.findIndex(
    (item) => item.type === 'user' && item.message.id === messageId,
  )
  if (index < 0) {
    return []
  }

  const byPath = new Map<string, AggregatedTurnFileChange>()
  for (const item of timeline.slice(index + 1)) {
    if (item.type !== 'agent-turn') {
      continue
    }
    for (const change of aggregateTurnFileDiffs(item.turn)) {
      const existing = byPath.get(change.path)
      if (!existing) {
        byPath.set(change.path, { ...change })
        continue
      }
      existing.additions += change.additions
      existing.deletions += change.deletions
      if (operationPriority[change.operation] > operationPriority[existing.operation]) {
        existing.operation = change.operation
      }
    }
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * For each path mutated after boundary message M, pick the userMessageId of the
 * first agent turn after M that touched that path (baseline key).
 */
export const resolveBaselinesForRevert = (
  timeline: ChatTimelineItem[],
  boundaryUserMessageId: string,
): FileCheckpointRestoreTarget[] => {
  const index = timeline.findIndex(
    (item) => item.type === 'user' && item.message.id === boundaryUserMessageId,
  )
  if (index < 0) {
    return []
  }

  const targets = new Map<string, string>()
  let currentUserMessageId = boundaryUserMessageId

  for (const item of timeline.slice(index + 1)) {
    if (item.type === 'user') {
      currentUserMessageId = item.message.id
      continue
    }
    if (item.type !== 'agent-turn') {
      continue
    }
    for (const change of aggregateTurnFileDiffs(item.turn)) {
      if (!targets.has(change.path)) {
        targets.set(change.path, currentUserMessageId)
      }
    }
  }

  return [...targets.entries()]
    .map(([path, userMessageId]) => ({ path, userMessageId }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Restore files for an agent turn: use the preceding user message as baseline key,
 * and include paths from this turn and all later turns.
 */
export const resolveBaselinesForAgentTurn = (
  timeline: ChatTimelineItem[],
  turnId: string,
): { precedingUserMessageId: string | null; targets: FileCheckpointRestoreTarget[] } => {
  const turnIndex = timeline.findIndex(
    (item) => item.type === 'agent-turn' && item.turn.id === turnId,
  )
  if (turnIndex < 0) {
    return { precedingUserMessageId: null, targets: [] }
  }

  let precedingUserMessageId: string | null = null
  for (let i = turnIndex - 1; i >= 0; i -= 1) {
    const item = timeline[i]
    if (item?.type === 'user') {
      precedingUserMessageId = item.message.id
      break
    }
  }
  if (!precedingUserMessageId) {
    return { precedingUserMessageId: null, targets: [] }
  }

  return {
    precedingUserMessageId,
    targets: resolveBaselinesForRevert(timeline, precedingUserMessageId),
  }
}

export const restoreFileCheckpoints = async (args: {
  projectSlug: string
  chatId: string
  projectRoot: string
  targets: FileCheckpointRestoreTarget[]
}): Promise<FileCheckpointRestoreResult> => {
  if (args.targets.length === 0) {
    return { restored: [], deleted: [], skipped: [], errors: [] }
  }
  return fileCheckpointRestore({
    projectSlug: args.projectSlug,
    chatId: args.chatId,
    projectRoot: args.projectRoot,
    targets: args.targets,
  })
}

export const summarizeMutationCounts = (
  changes: AggregatedTurnFileChange[],
): { files: number; created: number; updated: number; deleted: number; renamed: number } => {
  let created = 0
  let updated = 0
  let deleted = 0
  let renamed = 0
  for (const change of changes) {
    if (change.operation === 'create') created += 1
    else if (change.operation === 'delete') deleted += 1
    else if (change.operation === 'rename') renamed += 1
    else updated += 1
  }
  return { files: changes.length, created, updated, deleted, renamed }
}

export default restoreFileCheckpoints
