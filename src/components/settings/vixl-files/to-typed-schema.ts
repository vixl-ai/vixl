import type { TypedSchema } from 'vee-validate'
import type { z } from 'zod'

const isArrayIndex = (segment: PropertyKey): boolean => {
  if (typeof segment === 'number') {
    return Number.isInteger(segment) && segment >= 0
  }
  return typeof segment === 'string' && /^\d+$/.test(segment)
}

const toFormPath = (path: PropertyKey[]): string => {
  let result = ''
  for (const segment of path) {
    if (isArrayIndex(segment)) {
      result += `[${String(segment)}]`
      continue
    }
    const key = String(segment)
    result = result.length === 0 ? key : `${result}.${key}`
  }
  return result
}

export const toTypedSchema = <TSchema extends z.ZodType>(
  schema: TSchema,
): TypedSchema<z.input<TSchema>, z.output<TSchema>> => ({
  __type: 'VVTypedSchema',
  async parse(values) {
    const result = await schema.safeParseAsync(values)
    if (result.success) {
      return {
        value: result.data,
        errors: [],
      }
    }

    const byPath = new Map<string, string[]>()
    for (const issue of result.error.issues) {
      const path = toFormPath(issue.path)
      const messages = byPath.get(path)
      if (messages) {
        messages.push(issue.message)
      } else {
        byPath.set(path, [issue.message])
      }
    }

    return {
      errors: [...byPath.entries()].map(([path, errors]) => ({ path, errors })),
    }
  },
})
