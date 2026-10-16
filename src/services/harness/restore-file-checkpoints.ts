import aggregateToolRunFileDiffs from '@/services/harness/aggregate-tool-run-file-diffs'
import { fileCheckpointRestore } from '@/services/vixl/vixl-tauri'
import type { AgentTurn } from '@/types/chat/agent-turn'
import type {
  ChatTimelineItem,
  SubagentTimelineItem,
} from '@/types/chat/chat-timeline-item'
import type {
  AggregatedTurnFileChange,
  FileCheckpointRestoreResult,
  FileCheckpointRestoreTarget,
} from '@/types/harness/file-checkpoint'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import {
  hasGroupMembers,
  isLiveMemberRoot,
  parseMemberQualifiedPath,
} from '@/utils/parse-member-qualified-name'

const toolsFromTurn = (turn: AgentTurn) =>
  turn.steps.flatMap((step) => step.tools)

export const aggregateTurnFileDiffs = (
  turn: AgentTurn,
): AggregatedTurnFileChange[] => aggregateToolRunFileDiffs(toolsFromTurn(turn))

export const aggregateSubagentFileDiffs = (
  subagent: SubagentTimelineItem,
  existing: AggregatedTurnFileChange[] = [],
): AggregatedTurnFileChange[] =>
  aggregateToolRunFileDiffs(subagent.tools, existing)

export const aggregateChatFileDiffs = (
  timeline: ChatTimelineItem[],
): AggregatedTurnFileChange[] => {
  let changes: AggregatedTurnFileChange[] = []
  for (const item of timeline) {
    if (item.type === 'agent-turn') {
      changes = aggregateToolRunFileDiffs(toolsFromTurn(item.turn), changes)
      continue
    }
    if (item.type === 'subagent') {
      changes = aggregateSubagentFileDiffs(item, changes)
    }
  }
  return changes
}

const aggregatedChangesForItem = (
  item: ChatTimelineItem,
): AggregatedTurnFileChange[] => {
  if (item.type === 'agent-turn') {
    return aggregateTurnFileDiffs(item.turn)
  }
  if (item.type === 'subagent') {
    return aggregateSubagentFileDiffs(item)
  }
  return []
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

  return aggregateChatFileDiffs(timeline.slice(index + 1))
}

/**
 * For each path mutated after boundary message M, pick the userMessageId in
 * effect when the first agent-turn or subagent item after M touched that path
 * (baseline key).
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
    for (const change of aggregatedChangesForItem(item)) {
      if (!targets.has(change.path)) {
        targets.set(change.path, currentUserMessageId)
      }
      if (
        change.operation === 'rename' &&
        typeof change.renameTo === 'string' &&
        change.renameTo.length > 0 &&
        !targets.has(change.renameTo)
      ) {
        targets.set(change.renameTo, currentUserMessageId)
      }
    }
  }

  return [...targets.entries()]
    .map(([path, userMessageId]) => ({ path, userMessageId }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Restore files for an agent turn: use the preceding user message as baseline key,
 * and include paths from this turn and all later mutations.
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

type RestoreTargetGroup = {
  projectRoot: string
  targets: FileCheckpointRestoreTarget[]
  originalPaths: string[]
}

const emptyRestoreResult = (): FileCheckpointRestoreResult => ({
  restored: [],
  deleted: [],
  skipped: [],
  errors: [],
})

export const groupCheckpointRestoreTargets = (
  projectRoot: string,
  targets: FileCheckpointRestoreTarget[],
  members?: HarnessWorkspaceMember[],
): RestoreTargetGroup[] => {
  if (!hasGroupMembers(members)) {
    return [
      {
        projectRoot,
        targets,
        originalPaths: targets.map((target) => target.path),
      },
    ]
  }

  const groups = new Map<string, RestoreTargetGroup>()
  const ensureGroup = (root: string): RestoreTargetGroup => {
    const existing = groups.get(root)
    if (existing) {
      return existing
    }
    const created: RestoreTargetGroup = {
      projectRoot: root,
      targets: [],
      originalPaths: [],
    }
    groups.set(root, created)
    return created
  }

  for (const target of targets) {
    const qualified = parseMemberQualifiedPath(target.path, members)
    const group = qualified
      ? ensureGroup(qualified.member.rootPath)
      : ensureGroup(projectRoot)
    group.targets.push(
      qualified
        ? {
            path: qualified.path,
            userMessageId: target.userMessageId,
            key: target.path,
          }
        : target,
    )
    group.originalPaths.push(target.path)
  }

  return [...groups.values()]
}

const remapRestorePaths = (
  group: RestoreTargetGroup,
  paths: string[],
): string[] => {
  const originalByRestored = new Map<string, string>()
  for (let index = 0; index < group.targets.length; index += 1) {
    const restoredPath = group.targets[index]?.path
    const originalPath = group.originalPaths[index]
    if (!restoredPath || !originalPath) {
      continue
    }
    originalByRestored.set(restoredPath, originalPath)
  }
  return paths.map((path) => originalByRestored.get(path) ?? path)
}

export const restoreFileCheckpoints = async (args: {
  projectSlug: string
  chatId: string
  projectRoot: string
  targets: FileCheckpointRestoreTarget[]
  members?: HarnessWorkspaceMember[]
}): Promise<FileCheckpointRestoreResult> => {
  if (args.targets.length === 0) {
    return emptyRestoreResult()
  }

  const groups = groupCheckpointRestoreTargets(
    args.projectRoot,
    args.targets,
    args.members,
  )
  const merged = emptyRestoreResult()

  for (const group of groups) {
    if (group.targets.length === 0) {
      continue
    }
    if (!isLiveMemberRoot(group.projectRoot)) {
      merged.errors.push(
        ...group.originalPaths.map((path) => ({
          path,
          error: 'Project is no longer available',
        })),
      )
      continue
    }
    const result = await fileCheckpointRestore({
      projectSlug: args.projectSlug,
      chatId: args.chatId,
      projectRoot: group.projectRoot,
      targets: group.targets,
    })
    merged.restored.push(...remapRestorePaths(group, result.restored))
    merged.deleted.push(...remapRestorePaths(group, result.deleted))
    merged.skipped.push(...remapRestorePaths(group, result.skipped))
    merged.errors.push(
      ...result.errors.map((entry) => ({
        ...entry,
        path: remapRestorePaths(group, [entry.path])[0] ?? entry.path,
      })),
    )
  }

  return merged
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
