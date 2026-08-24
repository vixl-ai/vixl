import type { PermissionScope } from '@/types/harness/permission'

export const isNetworkSandboxApproval = (detail?: string): boolean =>
  typeof detail === 'string' && detail.includes('(network denied)')

export const onceApprovalLabel = (
  unsandboxed?: boolean,
  network?: boolean,
): string => {
  if (unsandboxed) return 'Run outside sandbox'
  if (network) return 'Allow network in sandbox'
  return 'Allow once'
}

export const prefersSessionApproval = (
  unsandboxed?: boolean,
  detail?: string,
): boolean => unsandboxed === true || isNetworkSandboxApproval(detail)

export const orderedApprovalScopes = (
  allowedScopes: PermissionScope[],
  unsandboxed?: boolean,
  detail?: string,
): PermissionScope[] => {
  const scopes = allowedScopes.filter((scope) => scope !== 'never')
  if (!prefersSessionApproval(unsandboxed, detail)) {
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
  detail?: string
}): ApprovalActionSpec[] => {
  const actions: ApprovalActionSpec[] = orderedApprovalScopes(
    args.allowedScopes,
    args.unsandboxed,
    args.detail,
  ).map((scope) => {
    let tooltip = onceApprovalLabel(
      args.unsandboxed,
      !args.unsandboxed && isNetworkSandboxApproval(args.detail),
    )
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
