import { getUserVixlDir, readJsonFile, writeJsonFile } from '@/services/vixl/vixl-tauri'

export type McpToolFingerprintSource = {
  name: string
  description?: string | null
  inputSchema?: Record<string, unknown> | null
  title?: string | null
}

export type McpToolBaseline = {
  serverId: string
  fingerprints: Record<string, string>
  updatedAt: string
}

const baselinePath = async (serverId: string): Promise<string> => {
  const root = await getUserVixlDir()
  return `${root}/mcp-trust-baselines/${encodeURIComponent(serverId)}.json`
}

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`
}

const digestHex = async (value: string): Promise<string> => {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export const fingerprintMcpTools = async (
  tools: McpToolFingerprintSource[],
): Promise<Record<string, string>> => {
  const fingerprints: Record<string, string> = {}
  for (const tool of tools) {
    const payload = stableStringify({
      name: tool.name,
      description: tool.description ?? '',
      title: tool.title ?? '',
      inputSchema: tool.inputSchema ?? null,
    })
    fingerprints[tool.name] = await digestHex(payload)
  }
  return fingerprints
}

export const detectMcpToolFingerprintDrift = (
  current: Record<string, string>,
  baseline: Record<string, string>,
): {
  changed: string[]
  added: string[]
  removed: string[]
} => {
  const changed: string[] = []
  const added: string[] = []
  const removed: string[] = []

  for (const [name, digest] of Object.entries(current)) {
    const previous = baseline[name]
    if (previous === undefined) {
      added.push(name)
      continue
    }
    if (previous !== digest) {
      changed.push(name)
    }
  }

  for (const name of Object.keys(baseline)) {
    if (!(name in current)) {
      removed.push(name)
    }
  }

  return { changed, added, removed }
}

export const loadMcpToolBaseline = async (
  serverId: string,
): Promise<McpToolBaseline | null> => {
  try {
    const raw = await readJsonFile(await baselinePath(serverId))
    if (
      typeof raw !== 'object' ||
      raw === null ||
      typeof (raw as McpToolBaseline).serverId !== 'string' ||
      typeof (raw as McpToolBaseline).fingerprints !== 'object' ||
      (raw as McpToolBaseline).fingerprints === null
    ) {
      return null
    }
    return raw as McpToolBaseline
  } catch {
    return null
  }
}

export const saveMcpToolBaseline = async (
  serverId: string,
  tools: McpToolFingerprintSource[],
): Promise<McpToolBaseline> => {
  const fingerprints = await fingerprintMcpTools(tools)
  const baseline: McpToolBaseline = {
    serverId,
    fingerprints,
    updatedAt: new Date().toISOString(),
  }
  await writeJsonFile(await baselinePath(serverId), baseline)
  return baseline
}

export const clearMcpToolBaseline = async (serverId: string): Promise<void> => {
  await writeJsonFile(await baselinePath(serverId), {
    serverId,
    fingerprints: null,
    updatedAt: new Date().toISOString(),
  })
}

export const detectMcpToolDrift = async (
  serverId: string,
  tools: McpToolFingerprintSource[],
): Promise<{
  drifted: boolean
  changed: string[]
  added: string[]
  removed: string[]
}> => {
  const baseline = await loadMcpToolBaseline(serverId)
  if (!baseline) {
    return { drifted: false, changed: [], added: [], removed: [] }
  }
  const current = await fingerprintMcpTools(tools)
  const drift = detectMcpToolFingerprintDrift(current, baseline.fingerprints)
  return {
    drifted:
      drift.changed.length > 0 ||
      drift.added.length > 0 ||
      drift.removed.length > 0,
    changed: drift.changed,
    added: drift.added,
    removed: drift.removed,
  }
}
