import { toast } from 'vue-sonner'
import type { ComputedRef, Ref } from 'vue'
import type { SettingsTab } from '@/composables/use-vixl-config'
import type useVixlConfig from '@/composables/use-vixl-config'
import type { VixlCustomProvider } from '@/types/vixl/vixl-settings'
import {
  getCustomProvider,
  getProviderCatalogEntry,
  keychainKeyForProvider,
  providerKeyRef,
  providerRequiresApiKey,
} from '@/services/providers/registry'
import { deleteSecret, getSecret, setSecret } from '@/services/vixl/vixl-tauri'
import { testProviderConnection } from '@/services/providers/test-connection'

type Settings = ReturnType<ReturnType<typeof useVixlConfig>['getScopeSettings']>

export type ProviderActionsDeps = {
  props: { tab: SettingsTab }
  config: ReturnType<typeof useVixlConfig>
  testingProviderId: Ref<string | null>
  manageDialogOpen: Ref<boolean>
  manageMode: Ref<'create' | 'edit'>
  manageProviderId: Ref<string | null>
  editApiKeyProviderId: Ref<string | null>
  apiKeyInput: Ref<string>
  settings: ComputedRef<Settings>
  setApiKeyConfigured: (providerId: string, configured: boolean) => void
  getApiKeyRef: (providerId: string) => string | undefined
  isCustomProvider: (providerId: string) => boolean
  refreshApiKeyStatus: () => Promise<void>
}

export const createProviderActions = (deps: ProviderActionsDeps) => {
  const handleManageSave = async (payload: {
    providerId: string
    provider: VixlCustomProvider
    apiKey: string | null
    clearApiKey: boolean
  }): Promise<void> => {
    const wasCreate = deps.manageMode.value === 'create'
    try {
      await deps.config.updateSetting(
        deps.props.tab,
        `providers.custom.${payload.providerId}` as keyof typeof deps.settings.value,
        payload.provider,
      )

      const keyRef = payload.provider.apiKeyRef ?? payload.providerId
      if (payload.clearApiKey) {
        await deleteSecret(keychainKeyForProvider(keyRef))
        deps.setApiKeyConfigured(payload.providerId, false)
      } else if (payload.apiKey) {
        await setSecret(keychainKeyForProvider(keyRef), payload.apiKey)
        deps.setApiKeyConfigured(payload.providerId, true)
      }

      await deps.refreshApiKeyStatus()

      if (wasCreate) {
        deps.manageMode.value = 'edit'
        deps.manageProviderId.value = payload.providerId
        deps.manageDialogOpen.value = true
        toast.success('Provider added', {
          description: 'Add or edit models below, then save again when you are done.',
        })
        return
      }

      // Keep the manage dialog open after edit so models can be iterated on.
      deps.manageProviderId.value = payload.providerId
      deps.manageMode.value = 'edit'
      deps.manageDialogOpen.value = true
      toast.success('Provider saved')
    } catch (error) {
      toast.error('Failed to save provider', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const saveApiKey = async (providerId: string): Promise<void> => {
    if (!deps.apiKeyInput.value.trim()) {
      toast.error('API key is required')
      return
    }

    try {
      const ref = deps.getApiKeyRef(providerId) ?? providerKeyRef(providerId)
      await setSecret(keychainKeyForProvider(ref), deps.apiKeyInput.value.trim())
      deps.setApiKeyConfigured(providerId, true)
      deps.apiKeyInput.value = ''
      deps.editApiKeyProviderId.value = null
      await deps.refreshApiKeyStatus()
      toast.success('API key saved')
    } catch (error) {
      toast.error('Failed to save API key', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const clearApiKey = async (providerId: string): Promise<void> => {
    const ref = deps.getApiKeyRef(providerId)
    if (!ref) {
      return
    }

    try {
      await deleteSecret(keychainKeyForProvider(ref))
      deps.setApiKeyConfigured(providerId, false)
      await deps.refreshApiKeyStatus()
      toast.success('API key cleared')
    } catch (error) {
      toast.error('Failed to clear API key', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const removeProvider = async (providerId: string): Promise<void> => {
    try {
      const ref = deps.getApiKeyRef(providerId)
      if (ref) {
        await deleteSecret(keychainKeyForProvider(ref))
      }

      const isCustom = deps.isCustomProvider(providerId)
      const keysToRemove = isCustom
        ? [`providers.custom.${providerId}`]
        : [`providers.${providerId}.apiKeyRef`]

      await deps.config.removeSettings(deps.props.tab, keysToRemove)
      toast.success('Provider removed')
    } catch (error) {
      toast.error('Failed to remove provider', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }

  const testConnection = async (providerId: string): Promise<void> => {
    deps.testingProviderId.value = providerId
    try {
      const custom = getCustomProvider(deps.settings.value, providerId)
      const requiresKey = providerRequiresApiKey(providerId, deps.settings.value)
      const ref = deps.getApiKeyRef(providerId)
      let apiKey = ''

      if (ref) {
        apiKey = (await getSecret(keychainKeyForProvider(ref))) ?? ''
      }

      if (requiresKey && !apiKey) {
        throw new Error(ref ? 'No API key in keychain' : 'No API key configured')
      }

      await testProviderConnection({
        providerId: custom ? 'openai' : providerId,
        apiKey,
        baseUrl: custom?.baseURL ?? getProviderCatalogEntry(providerId)?.defaultBaseUrl,
      })
      toast.success('Connection successful')
    } catch (error) {
      toast.error('Connection failed', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    } finally {
      deps.testingProviderId.value = null
    }
  }

  return {
    handleManageSave,
    saveApiKey,
    clearApiKey,
    removeProvider,
    testConnection,
  }
}
