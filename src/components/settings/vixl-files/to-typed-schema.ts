import type { TypedSchema } from 'vee-validate'
import type { z } from 'zod'

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
      const path = issue.path.map(String).join('.')
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
