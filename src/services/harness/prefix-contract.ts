import type { SystemPromptParts } from '@/services/context/system-prompt-parts'
import type { PrefixSnapshot } from '@/types/harness/prefix-snapshot'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'

const PREFIX_MODES = ['ask', 'plan', 'studio', 'agent', 'orchestrator'] as const

const LEGACY_MODE_RE = /in (ask|plan|studio|agent|orchestrator) mode/

type PrefixParts = {
  systemString: string
  toolSchemasJson: string
  mcpCatalogSnapshot: string
  rulesBodies: string
  mode?: VixlChatMode
  parts?: SystemPromptParts
}

const djb2 = (str: string): string => {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) ^ str.charCodeAt(i)
    hash = hash >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

const isChatMode = (value: unknown): value is VixlChatMode =>
  typeof value === 'string' && (PREFIX_MODES as readonly string[]).includes(value)

export const hashPrefixParts = (parts: PrefixParts): string => {
  const combined = [
    parts.systemString,
    parts.toolSchemasJson,
    parts.mcpCatalogSnapshot,
    parts.rulesBodies,
  ].join('\x00')
  return djb2(combined)
}

export const buildPrefixSnapshot = (parts: PrefixParts): PrefixSnapshot => ({
  systemString: parts.systemString,
  toolSchemasJson: parts.toolSchemasJson,
  mcpCatalogSnapshot: parts.mcpCatalogSnapshot,
  rulesBodies: parts.rulesBodies,
  hash: hashPrefixParts(parts),
  frozenAt: new Date().toISOString(),
  mode: parts.mode,
  parts: parts.parts,
})

const isSystemPromptParts = (value: unknown): value is SystemPromptParts => {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    typeof record.base === 'string' &&
    typeof record.tools === 'string' &&
    typeof record.mcp === 'string' &&
    typeof record.rules === 'string' &&
    typeof record.subagents === 'string' &&
    typeof record.mentions === 'string' &&
    typeof record.skills === 'string'
  )
}

/** Rebuild bucket parts from a frozen snapshot (new or legacy). */
export const partsFromFrozenPrefix = (snap: PrefixSnapshot): SystemPromptParts => {
  if (snap.parts && isSystemPromptParts(snap.parts)) {
    return { ...snap.parts }
  }

  // Legacy snapshots only stored catalog slices; keep systemString as base so
  // totals stay honest, and leave discrete buckets empty rather than double-count.
  return {
    base: snap.systemString,
    tools: '',
    mcp: '',
    rules: '',
    subagents: '',
    mentions: '',
    skills: '',
  }
}

export const inferPrefixMode = (systemString: string): VixlChatMode | null => {
  const match = LEGACY_MODE_RE.exec(systemString)
  return match && isChatMode(match[1]) ? match[1] : null
}

export const frozenPrefixMatchesMode = (
  snap: PrefixSnapshot,
  mode: VixlChatMode,
): boolean => {
  const frozenMode = snap.mode ?? inferPrefixMode(snap.systemString)
  return frozenMode === mode
}

export const getFrozenPrefix = (meta: { prefixSnapshot?: unknown }): PrefixSnapshot | null => {
  const snap = meta.prefixSnapshot
  if (
    typeof snap !== 'object' ||
    snap === null ||
    typeof (snap as Record<string, unknown>).systemString !== 'string' ||
    typeof (snap as Record<string, unknown>).hash !== 'string' ||
    typeof (snap as Record<string, unknown>).frozenAt !== 'string'
  ) {
    return null
  }
  const record = snap as Record<string, unknown>
  const parts = isSystemPromptParts(record.parts) ? record.parts : undefined
  const mode = isChatMode(record.mode) ? record.mode : undefined
  return {
    systemString: record.systemString as string,
    toolSchemasJson:
      typeof record.toolSchemasJson === 'string' ? record.toolSchemasJson : '',
    mcpCatalogSnapshot:
      typeof record.mcpCatalogSnapshot === 'string' ? record.mcpCatalogSnapshot : '',
    rulesBodies: typeof record.rulesBodies === 'string' ? record.rulesBodies : '',
    hash: record.hash as string,
    frozenAt: record.frozenAt as string,
    mode,
    parts,
  }
}
