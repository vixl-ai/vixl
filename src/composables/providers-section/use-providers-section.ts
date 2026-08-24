import { computed, ref, watch } from 'vue'

import { toast } from 'vue-sonner'

import useVixlConfig from '@/composables/use-vixl-config'

import type { SettingsTab } from '@/composables/use-vixl-config'

import type { VixlCustomProvider } from '@/types/vixl/vixl-settings'

import listConfiguredProviders from '@/services/providers/list-configured-providers'

import {
  getCustomProvider,
  getProviderCatalogEntry,
  keychainKeyForProvider,
  AI_SDK_PROVIDER_CATALOG,
  OPENAI_COMPATIBLE_PROVIDER_CATALOG,
  providerKeyRef,
  providerRequiresApiKey,
} from '@/services/providers/registry'
import { getSecret } from '@/services/vixl/vixl-tauri'
import { createProviderActions } from './provider-actions'

export default (props: {
  tab: SettingsTab
}) => {
  const config = useVixlConfig()
  const testingProviderId = ref<string | null>(null)
  const apiKeyConfigured = ref<Record<string, boolean>>({})
  const addDialogOpen = ref(false)
  const manageDialogOpen = ref(false)
  const manageMode = ref<'create' | 'edit'>('create')
  const manageProviderId = ref<string | null>(null)
  const editApiKeyProviderId = ref<string | null>(null)
  const apiKeyInput = ref('')
  const providerSearchQuery = ref('')

  let apiKeyStatusGeneration = 0

  const dialogSurfaceClass =
    'border-border/80 bg-zinc-50 shadow-2xl backdrop-blur-none dark:bg-zinc-900'

  const settings = computed(() => config.getScopeSettings(props.tab))

  const configuredProviders = computed(() => listConfiguredProviders(settings.value))

  const hasProviders = computed(() => configuredProviders.value.length > 0)

  const normalizedProviderSearch = computed(() => providerSearchQuery.value.trim().toLowerCase())

  const filteredAiSdkProviders = computed(() => {
    const query = normalizedProviderSearch.value
    if (!query) {
      return AI_SDK_PROVIDER_CATALOG
    }
    return AI_SDK_PROVIDER_CATALOG.filter(
      (entry) =>
        entry.name.toLowerCase().includes(query) || entry.id.toLowerCase().includes(query),
    )
  })

  const filteredOpenAiCompatibleProviders = computed(() => {
    const query = normalizedProviderSearch.value
    if (!query) {
      return OPENAI_COMPATIBLE_PROVIDER_CATALOG
    }
    return OPENAI_COMPATIBLE_PROVIDER_CATALOG.filter(
      (entry) =>
        entry.name.toLowerCase().includes(query) || entry.id.toLowerCase().includes(query),
    )
  })

  const hasProviderSearchResults = computed(
    () =>
      filteredAiSdkProviders.value.length > 0 ||
      filteredOpenAiCompatibleProviders.value.length > 0,
  )

  const manageInitialProvider = computed((): VixlCustomProvider | null => {
    if (!manageProviderId.value) {
      return null
    }
    return getCustomProvider(settings.value, manageProviderId.value) ?? null
  })

  const getApiKeyRef = (providerId: string): string | undefined => {
    const custom = getCustomProvider(settings.value, providerId)
    if (custom?.apiKeyRef) {
      return custom.apiKeyRef
    }
    const key = `providers.${providerId}.apiKeyRef` as const
    return settings.value[key]
  }

  const getProviderDisplayName = (providerId: string): string => {
    const custom = getCustomProvider(settings.value, providerId)
    if (custom?.name) {
      return custom.name
    }
    return getProviderCatalogEntry(providerId)?.name ?? providerId
  }

  const isCustomProvider = (providerId: string): boolean =>
    Boolean(getCustomProvider(settings.value, providerId))

  const hasApiKeyInKeychain = (providerId: string): boolean =>
    apiKeyConfigured.value[providerId] === true

  const refreshApiKeyStatus = async (): Promise<void> => {
    const generation = ++apiKeyStatusGeneration
    const next: Record<string, boolean> = {}

    for (const providerId of configuredProviders.value) {
      const ref = getApiKeyRef(providerId)
      if (!ref) {
        next[providerId] = false
        continue
      }

      try {
        const secret = await getSecret(keychainKeyForProvider(ref))
        if (generation !== apiKeyStatusGeneration) {
          return
        }
        next[providerId] = Boolean(secret)
      } catch {
        next[providerId] = false
      }
    }

    if (generation !== apiKeyStatusGeneration) {
      return
    }

    apiKeyConfigured.value = next
  }

  const setApiKeyConfigured = (providerId: string, configured: boolean): void => {
    apiKeyConfigured.value = {
      ...apiKeyConfigured.value,
      [providerId]: configured,
    }
  }

  const getCustomModelCount = (providerId: string): number =>
    getCustomProvider(settings.value, providerId)?.models?.length ?? 0

  const openApiKeyDialog = (providerId: string): void => {
    apiKeyInput.value = ''
    editApiKeyProviderId.value = providerId
  }

  const openAddDialog = (): void => {
    providerSearchQuery.value = ''
    addDialogOpen.value = true
  }

  const openCreateCustomDialog = (): void => {
    addDialogOpen.value = false
    manageMode.value = 'create'
    manageProviderId.value = null
    manageDialogOpen.value = true
  }

  const openManageCustomDialog = (providerId: string): void => {
    manageMode.value = 'edit'
    manageProviderId.value = providerId
    manageDialogOpen.value = true
  }

  const openEditDialog = (providerId: string): void => {
    if (isCustomProvider(providerId)) {
      openManageCustomDialog(providerId)
      return
    }
    openApiKeyDialog(providerId)
  }

  const resolveManageStoredApiKey = async (): Promise<string> => {
    if (!manageProviderId.value) {
      return ''
    }
    const ref = getApiKeyRef(manageProviderId.value)
    if (!ref) {
      return ''
    }
    return (await getSecret(keychainKeyForProvider(ref))) ?? ''
  }

  const handleAddDialogOpenChange = (open: boolean): void => {
    addDialogOpen.value = open
    if (!open) {
      providerSearchQuery.value = ''
    }
  }

  const addProvider = async (providerId: string): Promise<void> => {
    const ref = providerKeyRef(providerId)
    await config.updateSetting(
      props.tab,
      `providers.${providerId}.apiKeyRef` as keyof typeof settings.value,
      ref,
    )
    addDialogOpen.value = false
    if (providerRequiresApiKey(providerId, settings.value)) {
      openApiKeyDialog(providerId)
    }
  }

  const {
    handleManageSave,
    saveApiKey,
    clearApiKey,
    removeProvider,
    testConnection,
  } = createProviderActions({
    props,
    config,
    testingProviderId,
    manageDialogOpen,
    manageMode,
    manageProviderId,
    editApiKeyProviderId,
    apiKeyInput,
    settings,
    setApiKeyConfigured,
    getApiKeyRef,
    isCustomProvider,
    refreshApiKeyStatus,
  })

  watch(
    [configuredProviders, () => props.tab],
    async () => {
      try {
        await refreshApiKeyStatus()
      } catch (error) {
        toast.error('Failed to refresh API key status', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    },
    { immediate: true },
  )

  return {
    testingProviderId,
    apiKeyConfigured,
    addDialogOpen,
    manageDialogOpen,
    manageMode,
    manageProviderId,
    editApiKeyProviderId,
    apiKeyInput,
    providerSearchQuery,
    dialogSurfaceClass,
    settings,
    configuredProviders,
    hasProviders,
    normalizedProviderSearch,
    filteredAiSdkProviders,
    filteredOpenAiCompatibleProviders,
    hasProviderSearchResults,
    manageInitialProvider,
    getApiKeyRef,
    getProviderDisplayName,
    isCustomProvider,
    hasApiKeyInKeychain,
    getCustomModelCount,
    openApiKeyDialog,
    openAddDialog,
    openCreateCustomDialog,
    openManageCustomDialog,
    openEditDialog,
    resolveManageStoredApiKey,
    handleAddDialogOpenChange,
    addProvider,
    handleManageSave,
    saveApiKey,
    clearApiKey,
    removeProvider,
    testConnection,
    providerRequiresApiKey,
  }
}
