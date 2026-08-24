import type { ProviderModelGroup } from '@/types/models/provider-model-group'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import { isModelAllowed } from '@/services/models/model-catalog-options'
import loadProviderModelsCatalog from '@/services/models/catalog-cache'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import listConfiguredProviders from '@/services/providers/list-configured-providers'
import parseModelRef from '@/utils/parse-model-ref'
import serializeModelRef from '@/utils/serialize-model-ref'

type ResolveSpawnModelArgs = {
  callModel?: string
  lockedModel?: string | null
  frontmatterModel?: string
  settings: VixlSettings
}

const pickChosenModel = (args: ResolveSpawnModelArgs): string | undefined => {
  const callModel = args.callModel?.trim()
  if (callModel) {
    return callModel
  }
  const lockedModel = args.lockedModel?.trim()
  if (lockedModel) {
    return lockedModel
  }
  const frontmatterModel = args.frontmatterModel?.trim()
  if (frontmatterModel) {
    return frontmatterModel
  }
  return resolveModelForRole('subagent', args.settings)
}

const catalogHasModel = (
  groups: ProviderModelGroup[],
  providerId: string,
  modelId: string,
): boolean =>
  groups.some(
    (group) =>
      group.providerId === providerId &&
      group.models.some((model) => model.modelId === modelId),
  )

const resolveSpawnModel = async (
  args: ResolveSpawnModelArgs,
): Promise<string> => {
  const chosen = pickChosenModel(args)
  if (!chosen) {
    throw new Error('No sub-agent model configured')
  }

  const ref = parseModelRef(chosen)
  if (!ref) {
    throw new Error(
      `Model '${chosen}' is not an exact provider::modelId. Call resolve_models first.`,
    )
  }

  if (!isModelAllowed(args.settings, ref)) {
    throw new Error(`Subagent model ${serializeModelRef(ref)} is not allowed`)
  }

  const configured = listConfiguredProviders(args.settings)
  if (!configured.includes(ref.providerId)) {
    throw new Error(`Unknown provider '${ref.providerId}' for subagent model`)
  }

  const groups = await loadProviderModelsCatalog(args.settings)
  if (!catalogHasModel(groups, ref.providerId, ref.modelId)) {
    throw new Error(
      `Unknown model '${ref.modelId}' for provider '${ref.providerId}'`,
    )
  }

  return serializeModelRef(ref)
}

export default resolveSpawnModel
