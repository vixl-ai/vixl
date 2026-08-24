import type { LanguageModel } from 'ai'
import type {
  VixlCustomProviderModel,
  VixlSettings,
} from '@/types/vixl/vixl-settings'
import { getCustomProvider } from '@/services/providers/registry'

const hasImageSupportedUrls = async (model: LanguageModel): Promise<boolean> => {
  if (typeof model === 'string') {
    return false
  }
  if (!('supportedUrls' in model) || model.supportedUrls == null) {
    return false
  }
  const urls = await Promise.resolve(model.supportedUrls)
  // AI SDK adapters advertise vision via supportedUrls keys like "image/*".
  return Object.keys(urls).some(
    (mediaType) => mediaType === 'image' || mediaType.startsWith('image/'),
  )
}

const findCustomModel = (
  providerId: string,
  modelId: string,
  settings: VixlSettings,
): VixlCustomProviderModel | undefined => {
  const provider = getCustomProvider(settings, providerId)
  return provider?.models?.find((model) => model.id === modelId)
}

/**
 * Resolve whether the active model can consume image parts.
 *
 * - Custom providers: trust the user-configured `vision` flag on that model.
 * - Otherwise: ask the AI SDK LanguageModel via `supportedUrls` for `image` / `image/*`
 *   (what Anthropic/OpenAI/Google chat adapters advertise). No hand-maintained model lists.
 */
export default async (args: {
  model: LanguageModel
  providerId: string
  modelId: string
  settings: VixlSettings
}): Promise<boolean> => {
  const custom = findCustomModel(args.providerId, args.modelId, args.settings)
  if (custom) {
    return custom.vision === true
  }

  return hasImageSupportedUrls(args.model)
}
