import { asSchema, type FlexibleSchema } from 'ai'
import type { VixlChatMode, VixlSettings } from '@/types/vixl/vixl-settings'
import { MODE_TOOL_ALLOWLIST } from '@/services/harness/mode-allowlists'
import buildTools, { type HarnessToolContext } from '@/services/harness/build-tools'
import { defaultVixlSettings } from '@/schemas/vixl-settings'
import estimateTextTokens from '@/utils/estimate-text-tokens'

const buildStubContext = (settings: VixlSettings): HarnessToolContext => ({
  projectRoot: '/',
  projectSlug: '_budget',
  chatId: '_budget',
  mode: 'agent',
  settings,
  permissionLevel: 'bypass',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: false,
  supportsVision: false,
  onPendingApproval: () => {},
})

const estimateForSettings = (mode: VixlChatMode, settings: VixlSettings): number => {
  const tools = buildTools(buildStubContext(settings))
  const allow = new Set(MODE_TOOL_ALLOWLIST[mode])
  let total = 0

  for (const [name, definition] of Object.entries(tools)) {
    if (!allow.has(name)) {
      continue
    }

    const description = typeof definition.description === 'string' ? definition.description : name
    const schema = asSchema(definition.inputSchema as FlexibleSchema<unknown>)
    const json = JSON.stringify(schema.jsonSchema)

    total += estimateTextTokens(name) + estimateTextTokens(description) + estimateTextTokens(json)
  }

  return total
}

// Building 46 tool definitions and converting every zod schema to JSON schema
// is the most expensive constant cost in a budget recount, and the result only
// changes when settings change. Settings objects are replaced immutably by the
// config store, so identity-keyed caching is safe.
const cacheBySettings = new WeakMap<VixlSettings, Map<VixlChatMode, number>>()
const defaultCache = new Map<VixlChatMode, number>()

export default (mode: VixlChatMode, settings?: VixlSettings): number => {
  const cache = settings ? (cacheBySettings.get(settings) ?? new Map()) : defaultCache
  const cached = cache.get(mode)
  if (cached !== undefined) {
    return cached
  }
  const total = estimateForSettings(mode, settings ?? defaultVixlSettings())
  cache.set(mode, total)
  if (settings && !cacheBySettings.has(settings)) {
    cacheBySettings.set(settings, cache)
  }
  return total
}
