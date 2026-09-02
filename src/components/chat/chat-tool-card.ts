import type { PermissionScope } from '@/types/harness/permission'

export const isNetworkSandboxApproval = (
  detail?: string,
  needsNetwork?: boolean,
): boolean =>
  needsNetwork === true ||
  (typeof detail === 'string' && detail.includes('(network denied)'))

export const onceApprovalLabel = (unsandboxed?: boolean): string => {
  if (unsandboxed) return 'Run outside sandbox'
  return 'Allow once'
}

export const prefersSessionApproval = (unsandboxed?: boolean): boolean =>
  unsandboxed === true

export const orderedApprovalScopes = (
  allowedScopes: PermissionScope[],
  unsandboxed?: boolean,
): PermissionScope[] => {
  const scopes = allowedScopes.filter((scope) => scope !== 'never')
  if (!prefersSessionApproval(unsandboxed)) {
    return scopes
  }
  return [
    ...scopes.filter((scope) => scope === 'session'),
    ...scopes.filter((scope) => scope !== 'session'),
  ]
}

export type ApprovalActionKey = PermissionScope | 'deny'

export type ApprovalActionSpec = {
  key: ApprovalActionKey
  tooltip: string
  tone: 'default' | 'danger'
}

const SCOPE_TOOLTIPS: Record<Exclude<PermissionScope, 'once' | 'never'>, string> = {
  session: 'Allow session',
  workspace: 'Allow workspace',
  always: 'Always allow',
}

export const approvalActionSpecs = (args: {
  allowedScopes: PermissionScope[]
  unsandboxed?: boolean
}): ApprovalActionSpec[] => {
  const actions: ApprovalActionSpec[] = orderedApprovalScopes(
    args.allowedScopes,
    args.unsandboxed,
  ).map((scope) => {
    let tooltip = onceApprovalLabel(args.unsandboxed)
    if (scope === 'session' || scope === 'workspace' || scope === 'always') {
      tooltip = SCOPE_TOOLTIPS[scope]
    }
    return {
      key: scope,
      tooltip,
      tone: 'default' as const,
    }
  })
  actions.push({ key: 'deny', tooltip: 'Deny', tone: 'default' })
  if (args.allowedScopes.includes('never')) {
    actions.push({ key: 'never', tooltip: 'Never', tone: 'danger' })
  }
  return actions
}
