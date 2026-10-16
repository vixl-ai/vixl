const tails = new Map<string, Promise<unknown>>()

const withEditFileLock = async <T>(pathKey: string, work: () => Promise<T>): Promise<T> => {
  const previous = tails.get(pathKey) ?? Promise.resolve()
  const ready = previous.then(
    () => undefined,
    () => undefined,
  )
  const chained = ready.then(() => work())
  tails.set(pathKey, chained)
  try {
    return await chained
  } finally {
    if (tails.get(pathKey) === chained) {
      tails.delete(pathKey)
    }
  }
}

export default withEditFileLock
