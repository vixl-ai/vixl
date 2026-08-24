import type {
  VixlCustomProvider,
  VixlCustomProviderModel,
} from '@/types/vixl/vixl-settings'

export type KeyValueRow = {
  key: string
  value: string
}

export type PricingDraft = {
  inputPerMillion: string
  outputPerMillion: string
  cacheReadPerMillion: string
  cacheWritePerMillion: string
  reasoningPerMillion: string
}

export type ModelDraft = {
  id: string
  name: string
  maxInputTokens: string
  maxOutputTokens: string
  contextWindow: string
  toolCalling: boolean
  vision: boolean
  thinking: boolean
  streaming: boolean
  supportsReasoningEffort: string
  reasoningEffort: string
  temperature: string
  topP: string
  topK: string
  frequencyPenalty: string
  presencePenalty: string
  seed: string
  headers: KeyValueRow[]
  modelOptionsJson: string
  pricing: PricingDraft
  advancedOpen: boolean
}

export type ManageProviderDialogProps = {
  open: boolean
  mode: 'create' | 'edit'
  providerId?: string | null
  initialProvider?: VixlCustomProvider | null
  initialApiKeyConfigured?: boolean
  resolveStoredApiKey?: () => Promise<string>
}

export type ManageProviderDialogEmit = {
  (event: 'update:open', open: boolean): void
  (
    event: 'save',
    payload: {
      providerId: string
      provider: VixlCustomProvider
      apiKey: string | null
      clearApiKey: boolean
    },
  ): void
}

export type { VixlCustomProvider, VixlCustomProviderModel }
