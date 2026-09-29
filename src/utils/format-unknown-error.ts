export default (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>
    if (typeof record.message === 'string' && record.message.trim()) {
      return record.message
    }
    if (typeof record.error === 'string' && record.error.trim()) {
      return record.error
    }
    if (
      record.error &&
      typeof record.error === 'object' &&
      typeof (record.error as Record<string, unknown>).message === 'string'
    ) {
      const nested = (record.error as Record<string, unknown>).message
      if (typeof nested === 'string' && nested.trim()) {
        return nested
      }
    }
    try {
      const serialized = JSON.stringify(error)
      if (serialized && serialized !== '{}') {
        return serialized
      }
    } catch {
      return 'Unknown error'
    }
  }
  return 'Unknown error'
}
