import { asSchema } from 'ai'
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

export default (mode: VixlChatMode, settings?: VixlSettings): number => {
  const tools = buildTools(buildStubContext(settings ?? defaultVixlSettings()))
  const allow = new Set(MODE_TOOL_ALLOWLIST[mode])
  let total = 0

  for (const [name, definition] of Object.entries(tools)) {
    if (!allow.has(name)) {
      continue
    }

    const description =
      typeof definition.description === 'string' ? definition.description : name
    const schema = asSchema(definition.inputSchema)
    const json = JSON.stringify(schema.jsonSchema)

    total +=
      estimateTextTokens(name) +
      estimateTextTokens(description) +
      estimateTextTokens(json)
  }

  return total
}
