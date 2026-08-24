export const TERMINAL_LABEL_MAX = 48

export const clipTerminalLabel = (value: string): string => {
  const compact = value.trim().replace(/\s+/g, ' ')
  if (compact.length === 0) {
    return ''
  }
  if (compact.length <= TERMINAL_LABEL_MAX) {
    return compact
  }
  return `${compact.slice(0, TERMINAL_LABEL_MAX - 3).trimEnd()}...`
}
