/**
 * Marks a tool args/result payload so Vue skips deep reactive proxying.
 * Tool payloads are replaced immutably by the store and can be megabytes of
 * JSON; proxying them slows every serialization and diff that touches them.
 */
export default <T>(value: T): T =>
  value !== null && typeof value === 'object' ? (markRaw(value as object) as unknown as T) : value
