const asRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object') {
    return null
  }
  return value as Record<string, unknown>
}

const recordPath = (record: Record<string, unknown> | null): string => {
  if (!record || typeof record.path !== 'string') {
    return ''
  }
  return record.path
}

export default (existing: unknown, incoming: unknown): unknown => {
  const existingRecord = asRecord(existing)
  const incomingRecord = asRecord(incoming)
  if (!existingRecord && !incomingRecord) {
    return incoming !== undefined ? incoming : existing
  }
  const merged: Record<string, unknown> = {
    ...existingRecord,
    ...incomingRecord,
  }
  const existingPath = recordPath(existingRecord)
  const incomingPath = recordPath(incomingRecord)
  if (existingPath.length > 0 && incomingPath.length === 0) {
    merged.path = existingPath
  }
  return merged
}
