import type {
  SubagentRecord,
  SubagentWorkspace,
} from '@/types/harness/subagent-record'
import {
  isRunningSubagent,
  listSubagents,
} from '@/services/harness/subagent/registry'
import pathsEqual from '@/utils/paths-equal'

const workspaceMatches = (
  workspace: SubagentWorkspace,
  slug: string,
  rootPath?: string,
): boolean =>
  workspace.projectSlug === slug ||
  (rootPath !== undefined && pathsEqual(workspace.projectRoot, rootPath))

export const activeSubagentsForWorkspace = (
  slug: string,
  rootPath?: string,
): SubagentRecord[] =>
  listSubagents().filter(
    (record) =>
      isRunningSubagent(record) &&
      record.workspace !== undefined &&
      workspaceMatches(record.workspace, slug, rootPath),
  )
