import type { SubagentWorkspace } from '@/types/harness/subagent-record'

export const parseCapabilities = (
  value: unknown,
): 'read-only' | 'write' | undefined =>
  value === 'read-only' || value === 'write' ? value : undefined

export const parseOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === 'boolean' ? value : undefined

export const parseWorkspace = (value: unknown): SubagentWorkspace | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const record = value as Record<string, unknown>
  const projectRoot =
    typeof record.projectRoot === 'string' ? record.projectRoot : ''
  const projectSlug =
    typeof record.projectSlug === 'string' ? record.projectSlug : ''
  if (!projectRoot || !projectSlug) {
    return undefined
  }
  return { projectRoot, projectSlug }
}
