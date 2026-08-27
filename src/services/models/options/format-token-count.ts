const formatTokenCount = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return ''
  }
  if (value >= 1_000_000 && value % 1_000_000 === 0) {
    return `${value / 1_000_000}M`
  }
  if (value >= 1_000 && value % 1_000 === 0) {
    return `${value / 1_000}k`
  }
  return value.toLocaleString('en-US')
}

export default formatTokenCount
