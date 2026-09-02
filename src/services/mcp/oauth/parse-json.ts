const parseJson = <T>(raw: string | null): T | undefined => {
  if (raw === null || raw.length === 0) {
    return undefined
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

export default parseJson
