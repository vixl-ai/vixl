const originOf = (value: string | URL): string => {
  const url = typeof value === 'string' ? new URL(value) : value
  return url.origin
}

export default originOf
