import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createGateway } from '@ai-sdk/gateway'
import type { LanguageModel } from 'ai'
import type { VixlCustomProvider, VixlSettings } from '@/types/vixl/vixl-settings'
import {
  getCustomProvider,
  getProviderCatalogEntry,
  keychainKeyForProvider,
} from '@/services/providers/registry'
import { getSecret } from '@/services/vixl/vixl-tauri'
import proxyFetch from '@/services/providers/proxy-fetch'
import serializeOriginFetch from '@/services/providers/serialize-origin-fetch'

export type CreateModelInput = {
  providerId: string
  modelId: string
  settings: VixlSettings
  apiKey?: string
  /** Disable native thinking/reasoning for short side tasks (titles, etc.). */
  disableThinking?: boolean
}

const disableThinkingTransform = (
  args: Record<string, unknown>,
): Record<string, unknown> => {
  const existing =
    args.chat_template_kwargs &&
    typeof args.chat_template_kwargs === 'object' &&
    !Array.isArray(args.chat_template_kwargs)
      ? (args.chat_template_kwargs as Record<string, unknown>)
      : {}
  return {
    ...args,
    chat_template_kwargs: {
      ...existing,
      enable_thinking: false,
    },
  }
}

const resolveApiKey = async (
  providerId: string,
  settings: VixlSettings,
  override?: string,
): Promise<string> => {
  if (override) {
    return override
  }
  const custom = getCustomProvider(settings, providerId)
  const ref =
    custom?.apiKeyRef ??
    (settings[`providers.${providerId}.apiKeyRef` as keyof VixlSettings] as string | undefined)
  if (!ref) {
    return ''
  }
  return (await getSecret(keychainKeyForProvider(ref))) ?? ''
}

const mergeHeaders = (
  custom: VixlCustomProvider,
  modelId: string,
): Record<string, string> | undefined => {
  const modelHeaders = custom.models?.find((model) => model.id === modelId)?.headers
  if (!custom.headers && !modelHeaders) {
    return undefined
  }
  return {
    ...custom.headers,
    ...modelHeaders,
  }
}

export default async (input: CreateModelInput): Promise<LanguageModel> => {
  const { providerId, modelId, settings } = input
  const apiKey = await resolveApiKey(providerId, settings, input.apiKey)
  const custom = getCustomProvider(settings, providerId)
  const catalog = getProviderCatalogEntry(providerId)
  const fetch = proxyFetch()

  if (providerId === 'anthropic') {
    return createAnthropic({ apiKey, fetch })(modelId)
  }
  if (providerId === 'google') {
    return createGoogleGenerativeAI({ apiKey, fetch })(modelId)
  }
  if (providerId === 'gateway') {
    return createGateway({ apiKey: apiKey || undefined, fetch })(modelId)
  }

  if (custom) {
    const modelMeta = custom.models?.find((entry) => entry.id === modelId)
    return createOpenAICompatible({
      name: providerId,
      baseURL: custom.baseURL,
      apiKey: apiKey || undefined,
      headers: mergeHeaders(custom, modelId),
      queryParams: custom.queryParams,
      includeUsage: custom.includeUsage ?? true,
      supportsStructuredOutputs: custom.supportsStructuredOutputs,
      // Advertise image URL support when the user marked the model as vision-capable.
      ...(modelMeta?.vision
        ? {
            supportedUrls: () => ({
              'image/*': [/^https?:\/\/.*$/],
            }),
          }
        : {}),
      ...(input.disableThinking
        ? { transformRequestBody: disableThinkingTransform }
        : {}),
      fetch: serializeOriginFetch(fetch, custom.baseURL),
    })(modelId)
  }

  const baseURL = catalog?.defaultBaseUrl
  const openai = createOpenAI({
    apiKey,
    baseURL,
    fetch,
  })
  return openai(modelId)
}
