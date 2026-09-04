import type { ApprovalKind, PermissionScope } from '@/types/harness/permission'

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

export const prefersWorkspaceApproval = (kind?: ApprovalKind): boolean =>
  kind === 'fs'

export const orderedApprovalScopes = (
  allowedScopes: PermissionScope[],
  unsandboxed?: boolean,
  kind?: ApprovalKind,
): PermissionScope[] => {
  const scopes = allowedScopes.filter((scope) => scope !== 'never')
  if (prefersSessionApproval(unsandboxed)) {
    return [
      ...scopes.filter((scope) => scope === 'session'),
      ...scopes.filter((scope) => scope !== 'session'),
    ]
  }
  if (!prefersWorkspaceApproval(kind)) {
    return scopes
  }
  return [
    ...scopes.filter((scope) => scope === 'workspace'),
    ...scopes.filter((scope) => scope !== 'workspace'),
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
  kind?: ApprovalKind
}): ApprovalActionSpec[] => {
  const actions: ApprovalActionSpec[] = orderedApprovalScopes(
    args.allowedScopes,
    args.unsandboxed,
    args.kind,
  ).map((scope) => {
    let tooltip = onceApprovalLabel(args.unsandboxed)
    if (args.kind === 'fs' && scope === 'workspace') {
      tooltip = 'Allow file edits in this workspace'
    } else if (args.kind === 'fs' && scope === 'always') {
      tooltip = 'Always allow file edits'
    } else if (scope === 'session' || scope === 'workspace' || scope === 'always') {
      tooltip = SCOPE_TOOLTIPS[scope]
    }
    if (
      args.kind === 'shell' &&
      !args.unsandboxed &&
      (scope === 'once' || scope === 'session')
    ) {
      tooltip = `${tooltip}. Jail retry is included.`
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
