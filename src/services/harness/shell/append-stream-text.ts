export const MAX_STREAM_CHARS = 1_000_000
const STREAM_TRIM_THRESHOLD = MAX_STREAM_CHARS * 2

/**
 * Append shell output with a rolling cap. Keeps at most MAX_STREAM_CHARS per
 * stream so long-running commands cannot grow unbounded strings in memory.
 * Trims only once the buffer doubles the cap, keeping per-chunk cost
 * amortized instead of copying on every append.
 */
const appendStreamText = (current: string, data: string): string => {
  if (current.length === 0 && data.length <= MAX_STREAM_CHARS) {
    return data
  }
  const next = current + data
  if (next.length <= STREAM_TRIM_THRESHOLD) {
    return next
  }
  return next.slice(-MAX_STREAM_CHARS)
}

export default appendStreamText
