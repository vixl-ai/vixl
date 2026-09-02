import type { PermissionCapabilityKey } from '@/types/harness/permission'

const labelPermissionCapability = (
  capability: PermissionCapabilityKey,
): string => {
  if (capability === 'shell') return 'Shell'
  if (capability === 'shell.network') return 'Shell (network)'
  if (capability === 'shell.unsandboxed') return 'Shell (unsandboxed)'
  if (capability === 'git.commit') return 'Commit'
  if (capability === 'git.checkout') return 'Checkout'
  if (capability === 'git.branch_create') return 'Create branch'
  if (capability === 'fs.write') return 'All file writes'
  if (capability === 'fs.delete') return 'All file deletes'
  if (capability.startsWith('fs.write:')) return capability.slice('fs.write:'.length)
  if (capability.startsWith('fs.delete:')) return capability.slice('fs.delete:'.length)
  if (capability.startsWith('mcp:')) {
    const rest = capability.slice('mcp:'.length)
    const separator = rest.indexOf(':')
    if (separator === -1) return 'All tools'
    return rest.slice(separator + 1)
  }
  if (capability === 'web.fetch') return 'Web fetch'
  if (capability.startsWith('web.fetch:')) {
    return capability.slice('web.fetch:'.length)
  }
  return capability
}

export default labelPermissionCapability
