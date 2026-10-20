import type { PermissionScope } from '@/types/harness/permission'
import type { PermissionGateContext } from '@/services/harness/permission/gate'
import { requestApproval } from '@/services/harness/permission/approval-gate'

const WORKSPACE_MOVE_SCOPES: PermissionScope[] = ['once']

const gateWorkspaceMovePermission = async (args: {
  ctx: PermissionGateContext
  toolCallId: string
  name: string
  title: string
  detail?: string
  allowedScopes?: PermissionScope[]
  sessionKey?: string
}): Promise<boolean> => {
  if (args.sessionKey && args.ctx.sessionAllows.has(args.sessionKey)) {
    return true
  }

  const allowedScopes: PermissionScope[] = args.allowedScopes
    ? [...args.allowedScopes]
    : [...WORKSPACE_MOVE_SCOPES]

  args.ctx.onPendingApproval({
    toolCallId: args.toolCallId,
    name: args.name,
    kind: 'workspace',
    title: args.title,
    detail: args.detail,
    allowedScopes,
    subagentId: args.ctx.subagentId,
    subagentLabel: args.ctx.subagentLabel,
  })

  const result = await requestApproval({
    chatId: args.ctx.chatId,
    toolCallId: args.toolCallId,
    name: args.name,
    kind: 'workspace',
    action: 'workspace.move',
    capability: 'workspace.move',
    title: args.title,
    detail: args.detail,
    allowedScopes,
    subagentId: args.ctx.subagentId,
    subagentLabel: args.ctx.subagentLabel,
  })

  if (result.approved && result.scope === 'session' && args.sessionKey) {
    args.ctx.sessionAllows.add(args.sessionKey)
  }

  return result.approved
}

export default gateWorkspaceMovePermission
