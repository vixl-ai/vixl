import { computed, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { VixlCustomProvider } from '@/types/vixl/vixl-settings'
import {
  customProviderSchema,
  formatCustomProviderSchemaError,
} from '@/schemas/providers/custom-provider'
import { testProviderConnection } from '@/services/providers/test-connection'
import { listProviderModels } from '@/services/providers/list-provider-models'
import {
  createEmptyModel,
  draftToModel,
  modelToDraft,
  recordToRows,
  rowsToRecord,
  showPricingWarning,
} from './draft-helpers'
import type {
  KeyValueRow,
  ManageProviderDialogEmit,
  ManageProviderDialogProps,
  ModelDraft,
} from './types'

export default (props: ManageProviderDialogProps, emit: ManageProviderDialogEmit) => {
  const name = ref('local')
  const baseURL = ref('http://localhost:1234/v1')
  const apiKeyInput = ref('')
  const clearApiKey = ref(false)
  const includeUsage = ref(true)
  const supportsStructuredOutputs = ref(false)
  const headers = ref<KeyValueRow[]>([])
  const queryParams = ref<KeyValueRow[]>([])
  const models = ref<ModelDraft[]>([])
  const testing = ref(false)
  const importingModels = ref(false)
  const requestExtrasOpen = ref(false)

  const dialogSurfaceClass =
    'overflow-x-hidden border-border/80 bg-zinc-50 shadow-2xl backdrop-blur-none dark:bg-zinc-900 sm:max-w-2xl'

  const fieldClass = 'min-w-0 focus-visible:ring-inset'
  const flexFieldClass = 'min-w-0 flex-1 focus-visible:ring-inset'

  const title = computed(() =>
    props.mode === 'create' ? 'Custom OpenAI-compatible provider' : 'Manage provider',
  )

  const configuredModelCount = computed(
    () => models.value.filter((model) => model.id.trim().length > 0).length,
  )

  const resetForm = (): void => {
    const initial = props.initialProvider
    name.value = initial?.name ?? 'local'
    baseURL.value = initial?.baseURL ?? 'http://localhost:1234/v1'
    apiKeyInput.value = ''
    clearApiKey.value = false
    includeUsage.value = initial?.includeUsage ?? true
    supportsStructuredOutputs.value = initial?.supportsStructuredOutputs ?? false
    headers.value = recordToRows(initial?.headers)
    queryParams.value = recordToRows(initial?.queryParams)
    models.value = initial?.models?.map(modelToDraft) ?? []
    testing.value = false
    importingModels.value = false
    requestExtrasOpen.value = Boolean(initial?.headers || initial?.queryParams)
  }

  watch(
    () => [props.open, props.mode, props.providerId] as const,
    ([open]) => {
      if (open) {
        resetForm()
      }
    },
  )

  const handleOpenChange = (open: boolean): void => {
    emit('update:open', open)
  }

  const addKeyValueRow = (rows: KeyValueRow[]): void => {
    rows.push({ key: '', value: '' })
  }

  const removeKeyValueRow = (rows: KeyValueRow[], index: number): void => {
    rows.splice(index, 1)
  }

  const addModel = (partial?: Partial<ModelDraft>): void => {
    models.value.push({
      ...createEmptyModel(),
      ...partial,
    })
  }

  const removeModel = (index: number): void => {
    models.value.splice(index, 1)
  }

  const resolveApiKeyForRequest = async (): Promise<string> => {
    if (apiKeyInput.value.trim()) {
      return apiKeyInput.value.trim()
    }
    if (props.resolveStoredApiKey) {
      return (await props.resolveStoredApiKey()) || ''
    }
    return ''
  }

  const importModelsFromEndpoint = async (): Promise<void> => {
    importingModels.value = true
    try {
      const trimmedBaseUrl = baseURL.value.trim()
      if (!trimmedBaseUrl) {
        throw new Error('Base URL is required')
      }

      const liveRows = await listProviderModels({
        providerId: 'openai',
        apiKey: await resolveApiKeyForRequest(),
        baseUrl: trimmedBaseUrl,
      })

      if (liveRows.length === 0) {
        toast.error('No models returned by endpoint')
        return
      }

      const existing = new Set(
        models.value.map((model) => model.id.trim()).filter((id) => id.length > 0),
      )
      let added = 0
      for (const row of liveRows) {
        const modelId = row.id
        if (existing.has(modelId)) {
          continue
        }
        addModel({ id: modelId, name: modelId })
        existing.add(modelId)
        added += 1
      }

      if (added === 0) {
        toast.success('All endpoint models are already in the list')
        return
      }

      toast.success(`Imported ${added} model${added === 1 ? '' : 's'}`)
    } catch (error) {
      toast.error('Failed to import models', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      importingModels.value = false
    }
  }

  const buildProvider = (): { providerId: string; provider: VixlCustomProvider } => {
    const trimmedName = name.value.trim()
    const trimmedBaseUrl = baseURL.value.trim()
    const providerId =
      props.mode === 'edit' && props.providerId
        ? props.providerId
        : trimmedName.toLowerCase().replace(/\s+/g, '-')

    const providerModels = models.value
      .filter((draft) => draft.id.trim().length > 0)
      .map(draftToModel)

    const provider: VixlCustomProvider = {
      type: 'openai-compatible',
      name: trimmedName,
      baseURL: trimmedBaseUrl,
      apiKeyRef: props.initialProvider?.apiKeyRef ?? providerId,
      includeUsage: includeUsage.value,
      supportsStructuredOutputs: supportsStructuredOutputs.value || undefined,
      headers: rowsToRecord(headers.value),
      queryParams: rowsToRecord(queryParams.value),
      models: providerModels.length > 0 ? providerModels : undefined,
    }

    const parsed = customProviderSchema.safeParse(provider)
    if (!parsed.success) {
      throw new Error(formatCustomProviderSchemaError(parsed.error))
    }

    return { providerId, provider: parsed.data }
  }

  const handleTestConnection = async (): Promise<void> => {
    testing.value = true
    try {
      const { provider } = buildProvider()
      await testProviderConnection({
        providerId: 'openai',
        apiKey: await resolveApiKeyForRequest(),
        baseUrl: provider.baseURL,
      })
      toast.success('Connection successful')
    } catch (error) {
      toast.error('Connection failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      testing.value = false
    }
  }

  const handleSave = (): void => {
    try {
      const { providerId, provider } = buildProvider()
      emit('save', {
        providerId,
        provider,
        apiKey: apiKeyInput.value.trim() ? apiKeyInput.value.trim() : null,
        clearApiKey: clearApiKey.value,
      })
    } catch (error) {
      toast.error('Invalid provider configuration', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  return {
    name,
    baseURL,
    apiKeyInput,
    clearApiKey,
    includeUsage,
    supportsStructuredOutputs,
    headers,
    queryParams,
    models,
    testing,
    importingModels,
    requestExtrasOpen,
    dialogSurfaceClass,
    fieldClass,
    flexFieldClass,
    title,
    configuredModelCount,
    showPricingWarning,
    handleOpenChange,
    addKeyValueRow,
    removeKeyValueRow,
    addModel,
    removeModel,
    importModelsFromEndpoint,
    handleTestConnection,
    handleSave,
  }
}
