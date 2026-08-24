import type { FileDiff } from '@/types/harness/file-diff'
import type {
  PermissionAction,
  PermissionCapabilityKey,
  PermissionLevel,
  PermissionScope,
} from '@/types/harness/permission'
import type { PyrolaSettings } from '@/types/pyrola/pyrola-settings'
import {
  requestApproval,
  type ApprovalKind,
} from '@/services/harness/permission/approval-gate'
import {
  decidePermission,
  isStickyShellElevation,
} from '@/services/harness/permission/policy'

export type PendingApprovalView = {
  toolCallId: string
  name: string
  kind: ApprovalKind
  title: string
  detail?: string
  unsandboxed?: boolean
  allowedScopes: PermissionScope[]
  diff?: FileDiff[]
  serverId?: string
  subagentId?: string
  subagentLabel?: string
}

export type PermissionGateContext = {
  chatId: string
  settings: PyrolaSettings
  permissionLevel: PermissionLevel
  sessionAllows: Set<string>
  sessionDenies: Set<string>
  sandboxEnabled: boolean
  onPendingApproval: (entry: PendingApprovalView) => void
  persistPermission?: (
    capability: PermissionCapabilityKey,
    verdict: 'allow' | 'deny',
    scope: 'workspace' | 'always',
  ) => Promise<void>
  subagentId?: string
  subagentLabel?: string
}

export const gateToolPermission = async (args: {
  ctx: PermissionGateContext
  toolCallId: string
  name: string
  kind: ApprovalKind
  action: PermissionAction
  capability: PermissionCapabilityKey
  title: string
  detail?: string
  unsandboxed?: boolean
  paths?: string[]
  diff?: FileDiff[]
  serverId?: string
}): Promise<boolean> => {
  const decision = decidePermission({
    action: args.action,
    capability: args.capability,
    paths: args.paths,
    settings: args.ctx.settings,
    permissionLevel: args.ctx.permissionLevel,
    sessionAllows: args.ctx.sessionAllows,
    sessionDenies: args.ctx.sessionDenies,
    sandboxEnabled: args.ctx.sandboxEnabled,
  })

  if (decision.verdict === 'allow') {
    return true
  }
  if (decision.verdict === 'deny') {
    return false
  }

  args.ctx.onPendingApproval({
    toolCallId: args.toolCallId,
    name: args.name,
    kind: args.kind,
    title: args.title,
    detail: args.detail ?? decision.reason,
    unsandboxed: args.unsandboxed,
    allowedScopes: decision.allowedScopes,
    diff: args.diff,
    serverId: args.serverId,
    subagentId: args.ctx.subagentId,
    subagentLabel: args.ctx.subagentLabel,
  })

  const result = await requestApproval({
    chatId: args.ctx.chatId,
    toolCallId: args.toolCallId,
    name: args.name,
    kind: args.kind,
    action: args.action,
    capability: args.capability,
    title: args.title,
    detail: args.detail ?? decision.reason,
    unsandboxed: args.unsandboxed,
    allowedScopes: decision.allowedScopes,
    diff: args.diff,
    subagentId: args.ctx.subagentId,
    subagentLabel: args.ctx.subagentLabel,
  })

  if (!result.approved) {
    if (result.scope === 'never') {
      args.ctx.sessionDenies.add(args.capability)
      await args.ctx.persistPermission?.(args.capability, 'deny', 'always')
    }
    return false
  }

  if (
    result.scope === 'session' ||
    result.scope === 'workspace' ||
    result.scope === 'always' ||
    (result.scope === 'once' && isStickyShellElevation(args.capability))
  ) {
    args.ctx.sessionAllows.add(args.capability)
  }
  if (result.scope === 'workspace' || result.scope === 'always') {
    await args.ctx.persistPermission?.(
      args.capability,
      'allow',
      result.scope === 'workspace' ? 'workspace' : 'always',
    )
  }

  return true
}
