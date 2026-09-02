const tokenize = (value: string | undefined): string[] => {
  if (!value) {
    return []
  }
  return value.split(/\s+/).filter((token) => token.length > 0)
}

const unionScopes = (
  previous?: string,
  challenge?: string,
): string => {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const token of [...tokenize(previous), ...tokenize(challenge)]) {
    if (seen.has(token)) {
      continue
    }
    seen.add(token)
    ordered.push(token)
  }
  return ordered.join(' ')
}

export default unionScopes
