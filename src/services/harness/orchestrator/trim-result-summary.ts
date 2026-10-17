const SUMMARY_CAP = 500

export default (summary: string): string => {
  const trimmed = summary.trim()
  if (trimmed.length <= SUMMARY_CAP) {
    return trimmed
  }
  return `${trimmed.slice(0, SUMMARY_CAP)}...`
}
