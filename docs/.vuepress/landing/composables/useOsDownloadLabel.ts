import { onMounted, ref } from 'vue'

function detectLabel(): string {
  if (typeof navigator === 'undefined') return 'Download'
  const ua = navigator.userAgent
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } })
    .userAgentData?.platform

  const haystack = `${platform ?? ''} ${ua}`
  if (/mac|iphone|ipad|ipod/i.test(haystack)) return 'Download for macOS'
  if (/win/i.test(haystack)) return 'Download for Windows'
  if (/linux|x11|cros/i.test(haystack)) return 'Download for Linux'
  return 'Download'
}

export function useOsDownloadLabel() {
  const label = ref('Download')

  onMounted(() => {
    label.value = detectLabel()
  })

  return label
}
