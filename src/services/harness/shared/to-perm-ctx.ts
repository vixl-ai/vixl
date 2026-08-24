import type { PermissionGateContext } from '@/services/harness/permission/gate'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const toPermCtx = (ctx: HarnessToolContext): PermissionGateContext => ({
  chatId: ctx.chatId,
  settings: ctx.settings,
  permissionLevel: ctx.permissionLevel,
  sessionAllows: ctx.sessionAllows,
  sessionDenies: ctx.sessionDenies,
  sandboxEnabled: ctx.sandboxEnabled,
  onPendingApproval: ctx.onPendingApproval,
  persistPermission: ctx.persistPermission,
  subagentId: ctx.subagentId,
  subagentLabel: ctx.subagentLabel,
})

export default toPermCtx
