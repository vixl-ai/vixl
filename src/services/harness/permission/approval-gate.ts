import picomatch from 'picomatch'
import type { FileDiff } from '@/types/harness/file-diff'
import type {
  ApprovalKind,
  PermissionAction,
  PermissionCapabilityKey,
  PermissionScope,
} from '@/types/harness/permission'

export type { ApprovalKind }

export type PendingApproval = {
  chatId: string
  toolCallId: string
  name: string
  kind: ApprovalKind
  action: PermissionAction
  capability: PermissionCapabilityKey
  title: string
  detail?: string
  unsandboxed?: boolean
  needsNetwork?: boolean
  allowedScopes: PermissionScope[]
  diff?: FileDiff[]
  subagentId?: string
  subagentLabel?: string
  resolve: (result: ApprovalResolution) => void
}

export type ApprovalResolution =
  | { approved: false; scope: 'once' | 'never' }
  | { approved: true; scope: Exclude<PermissionScope, 'never'> }

const pending = new Map<string, PendingApproval>()

export const requestApproval = (
  entry: Omit<PendingApproval, 'resolve'>,
): Promise<ApprovalResolution> =>
  new Promise((resolve) => {
    pending.set(entry.toolCallId, { ...entry, resolve })
  })

export const getPendingApproval = (toolCallId: string): PendingApproval | undefined =>
  pending.get(toolCallId)

export const listPendingApprovalsForChat = (chatId: string): PendingApproval[] =>
  [...pending.values()].filter((entry) => entry.chatId === chatId)

export const resolveApproval = (toolCallId: string, result: ApprovalResolution): void => {
  const entry = pending.get(toolCallId)
  if (!entry) {
    return
  }
  pending.delete(toolCallId)
  entry.resolve(result)
}

export const rejectPendingForChat = (chatId: string): void => {
  for (const [toolCallId, entry] of pending.entries()) {
    if (entry.chatId !== chatId) {
      continue
    }
    pending.delete(toolCallId)
    entry.resolve({ approved: false, scope: 'once' })
  }
}

export const resetApprovalGateForTests = (): void => {
  pending.clear()
}

export const matchesAutoApproveGlob = (path: string, globs: string[]): boolean =>
  globs.some((glob) =>
    picomatch.isMatch(path, glob, {
      dot: true,
      windows: true,
    }),
  )

export const shouldAutoApprove = (
  paths: string[],
  autoApproveGlobs: string[],
): boolean =>
  autoApproveGlobs.length > 0 &&
  paths.every((path) => matchesAutoApproveGlob(path, autoApproveGlobs))
