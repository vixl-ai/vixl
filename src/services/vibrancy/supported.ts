const isVibrancySupported = (): boolean => {
  if (
    typeof navigator !== 'undefined' &&
    navigator.userAgent.toLowerCase().includes('linux')
  ) {
    return false
  }

  return true
}

export default isVibrancySupported
