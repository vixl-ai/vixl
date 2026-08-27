const parseCatalogTokenOverride = (
  raw: string,
  reportedMax?: number,
): number | undefined => {
  const trimmed = raw.trim()
  if (trimmed === '' || !/^\d+$/.test(trimmed)) {
    return undefined
  }
  const value = Number(trimmed)
  if (!Number.isInteger(value) || value <= 0) {
    return undefined
  }
  if (typeof reportedMax === 'number' && reportedMax > 0) {
    return Math.min(value, reportedMax)
  }
  return value
}

export default parseCatalogTokenOverride
