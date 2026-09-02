const DCR_PATTERNS = [
  /dynamic client registration/i,
  /does not support dynamic client registration/i,
  /must be saveable for dynamic registration/i,
  /registration_endpoint/i,
  /failed to register/i,
  /client registration/i,
]

const isDcrMissingClientError = (error: unknown): boolean => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : String(error)
  if (DCR_PATTERNS.some((pattern) => pattern.test(message))) {
    return true
  }
  if (error instanceof Error && error.name === 'InvalidClientError') {
    return true
  }
  return /invalid_client/i.test(message)
}

export default isDcrMissingClientError
