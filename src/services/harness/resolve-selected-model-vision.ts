import type { VixlSettings } from '@/types/vixl/vixl-settings'
import createModel from '@/services/providers/create-model'
import resolveModelVision from '@/services/harness/resolve-model-vision'
import parseModelRef from '@/utils/parse-model-ref'

/**
 * Composer-side vision gate for attachment decisions.
 *
 * Uses the same createModel + resolveModelVision path as the orchestrator so
 * custom `vision` flags and LanguageModel `supportedUrls` stay consistent.
 * On parse/create failure, defaults to true (safer to attach PNG; non-vision
 * models still get images stripped later in prepareMessagesForModelVision).
 */
export default async (args: {
  modelRef: string
  settings: VixlSettings
}): Promise<boolean> => {
  const parsed = parseModelRef(args.modelRef)
  if (!parsed) {
    return true
  }

  try {
    const model = await createModel({
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      settings: args.settings,
    })
    return await resolveModelVision({
      model,
      providerId: parsed.providerId,
      modelId: parsed.modelId,
      settings: args.settings,
    })
  } catch {
    return true
  }
}
