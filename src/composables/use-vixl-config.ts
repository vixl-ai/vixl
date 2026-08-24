import { computed, onMounted, ref, shallowRef } from 'vue'
import { toast } from 'vue-sonner'
import type { VixlSettings, VixlTheme } from '@/types/vixl/vixl-settings'
import { defaultVixlSettings } from '@/schemas/vixl-settings'
import { stripPersonalOnlyProjectOverrides } from '@/services/config/merge-settings'
import {
  isProjectOverride,
  loadEffectiveSettings,
  loadPersonalSettings,
  loadProjectSettings,
  resetSettingsKeys,
  resetSettingsSection,
  saveSettings,
} from '@/services/config/vixl-config'
import useFleetRegistry from '@/composables/use-fleet-registry'

export type SettingsTab = 'personal' | 'project'

const hydrated = ref(false)
const personalSettings = shallowRef<VixlSettings>(defaultVixlSettings())
const projectSettings = shallowRef<VixlSettings>({ version: 1 })
const effectiveSettings = shallowRef<VixlSettings>(defaultVixlSettings())

export default () => {
  const fleet = useFleetRegistry()

  const activeRootPath = computed(() => fleet.activeProject.value?.rootPath ?? null)
  const showProjectTab = computed(
    () => activeRootPath.value !== null && fleet.hasProjectVixl.value,
  )

  const refreshAll = async (): Promise<void> => {
    personalSettings.value = await loadPersonalSettings()
    if (activeRootPath.value) {
      projectSettings.value = await loadProjectSettings(activeRootPath.value)
      effectiveSettings.value = await loadEffectiveSettings(activeRootPath.value)
    } else {
      projectSettings.value = { version: 1 }
      effectiveSettings.value = personalSettings.value
    }
    hydrated.value = true
  }

  const getScopeSettings = (tab: SettingsTab): VixlSettings =>
    tab === 'personal' ? personalSettings.value : projectSettings.value

  const updateSetting = async <K extends keyof VixlSettings>(
    tab: SettingsTab,
    key: K,
    value: VixlSettings[K],
  ): Promise<void> => {
    const current = { ...getScopeSettings(tab), [key]: value, version: 1 as const }

    if (tab === 'personal') {
      personalSettings.value = current
      await saveSettings('personal', current)
    } else {
      if (!activeRootPath.value) {
        return
      }
      const stripped = stripPersonalOnlyProjectOverrides(current)
      projectSettings.value = stripped
      await saveSettings('project', stripped, activeRootPath.value)
    }

    effectiveSettings.value = await loadEffectiveSettings(activeRootPath.value)
  }

  const removeSettings = async (
    tab: SettingsTab,
    keys: string[],
  ): Promise<void> => {
    const current = getScopeSettings(tab)

    if (tab === 'personal') {
      personalSettings.value = await resetSettingsKeys('personal', keys, current)
    } else {
      if (!activeRootPath.value) {
        return
      }
      projectSettings.value = await resetSettingsKeys(
        'project',
        keys,
        current,
        activeRootPath.value,
      )
    }

    effectiveSettings.value = await loadEffectiveSettings(activeRootPath.value)
  }

  const resetSectionToPersonal = async (
    tab: SettingsTab,
    sectionPrefix: string,
  ): Promise<void> => {
    if (tab !== 'project' || !activeRootPath.value) {
      return
    }
    projectSettings.value = await resetSettingsSection(
      'project',
      sectionPrefix,
      projectSettings.value,
      activeRootPath.value,
    )
    effectiveSettings.value = await loadEffectiveSettings(activeRootPath.value)
  }

  const usingPersonalDefault = (key: string): boolean =>
    !isProjectOverride(projectSettings.value, key)

  onMounted(async () => {
    if (!hydrated.value) {
      try {
        await refreshAll()
      } catch (error) {
        toast.error('Failed to load settings', {
          description: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }
  })

  return {
    hydrated,
    personalSettings,
    projectSettings,
    effectiveSettings,
    activeRootPath,
    showProjectTab,
    refreshAll,
    getScopeSettings,
    updateSetting,
    removeSettings,
    resetSectionToPersonal,
    usingPersonalDefault,
    setTheme: (tab: SettingsTab, theme: VixlTheme) =>
      updateSetting(tab, 'appearance.theme', theme),
  }
}

export const useVixlConfigHydration = () => hydrated
