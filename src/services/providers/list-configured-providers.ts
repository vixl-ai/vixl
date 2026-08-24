import type { VixlSettings } from '@/types/vixl/vixl-settings'

export default (settings: VixlSettings): string[] => {
  const ids = new Set<string>()

  for (const key of Object.keys(settings)) {
    if (key.startsWith('providers.') && key.endsWith('.apiKeyRef')) {
      ids.add(key.replace('providers.', '').replace('.apiKeyRef', ''))
    }
    if (key.startsWith('providers.custom.')) {
      ids.add(key.replace('providers.custom.', ''))
    }
  }

  return [...ids]
}
