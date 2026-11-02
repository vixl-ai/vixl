const isSensitiveBlocked = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return /sensitive path blocked/i.test(message)
}

export const previewIgnoringSensitiveBlock = async <T>(
  run: () => Promise<T>,
  fallback: T,
): Promise<T> => {
  try {
    return await run()
  } catch (error) {
    if (isSensitiveBlocked(error)) {
      return fallback
    }
    throw error
  }
}
