import type {
  ApprovalKind,
  PermissionCapabilityKey,
  PermissionRecord,
} from '@/types/harness/permission'
import type {
  PermissionGroup,
  PermissionSubgroup,
} from '@/types/harness/permission-group'

const GROUP_ORDER: { kind: ApprovalKind; label: string }[] = [
  { kind: 'fs', label: 'Filesystem' },
  { kind: 'shell', label: 'Shell' },
  { kind: 'git', label: 'Git' },
  { kind: 'mcp', label: 'MCP' },
  { kind: 'web', label: 'Web' },
]

const FS_SUBGROUP_ORDER = ['write', 'delete'] as const

const kindFor = (capability: PermissionCapabilityKey): ApprovalKind => {
  if (
    capability === 'shell' ||
    capability === 'shell.network' ||
    capability === 'shell.unsandboxed'
  ) {
    return 'shell'
  }
  if (
    capability === 'git.commit' ||
    capability === 'git.checkout' ||
    capability === 'git.branch_create'
  ) {
    return 'git'
  }
  if (
    capability === 'fs.write' ||
    capability === 'fs.delete' ||
    capability.startsWith('fs.write:') ||
    capability.startsWith('fs.delete:')
  ) {
    return 'fs'
  }
  if (capability.startsWith('mcp:')) return 'mcp'
  if (capability === 'web.fetch' || capability.startsWith('web.fetch:')) return 'web'
  return 'fs'
}

const subgroupFor = (
  capability: PermissionCapabilityKey,
): { key: string; label: string | null } => {
  if (capability === 'fs.write' || capability.startsWith('fs.write:')) {
    return { key: 'write', label: 'Write' }
  }
  if (capability === 'fs.delete' || capability.startsWith('fs.delete:')) {
    return { key: 'delete', label: 'Delete' }
  }
  if (capability.startsWith('mcp:')) {
    const rest = capability.slice('mcp:'.length)
    const serverId = rest.split(':')[0] || rest
    return { key: serverId, label: serverId }
  }
  if (capability.startsWith('web.fetch:')) {
    const host = capability.slice('web.fetch:'.length)
    return { key: host, label: host }
  }
  return { key: kindFor(capability), label: null }
}

const groupPersistedPermissionRecords = (
  records: PermissionRecord[],
): PermissionGroup[] => {
  const byKind = new Map<ApprovalKind, Map<string, PermissionSubgroup>>()
  for (const group of GROUP_ORDER) {
    byKind.set(group.kind, new Map())
  }

  for (const record of records) {
    const kind = kindFor(record.capability)
    const kindBuckets = byKind.get(kind)
    if (!kindBuckets) continue

    const subgroup = subgroupFor(record.capability)
    const existing = kindBuckets.get(subgroup.key)
    if (existing) {
      existing.records.push(record)
    } else {
      kindBuckets.set(subgroup.key, {
        key: subgroup.key,
        label: subgroup.label,
        records: [record],
      })
    }
  }

  return GROUP_ORDER.flatMap((group) => {
    const kindBuckets = byKind.get(group.kind)
    if (!kindBuckets || kindBuckets.size === 0) return []

    let subgroups = [...kindBuckets.values()]
    if (group.kind === 'fs') {
      subgroups = FS_SUBGROUP_ORDER.flatMap((key) => {
        const subgroup = kindBuckets.get(key)
        return subgroup ? [subgroup] : []
      })
    } else if (group.kind === 'mcp' || group.kind === 'web') {
      subgroups.sort((a, b) => a.key.localeCompare(b.key))
    }

    return [
      {
        kind: group.kind,
        label: group.label,
        subgroups,
      },
    ]
  })
}

export default groupPersistedPermissionRecords
