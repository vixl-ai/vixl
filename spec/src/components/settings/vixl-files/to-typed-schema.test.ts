import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { toTypedSchema } from '@/components/settings/vixl-files/to-typed-schema'

describe('toTypedSchema', () => {
  const schema = z.object({
    name: z.string().min(1),
    body: z.string(),
  })

  it('returns the parsed value for valid input', async () => {
    const result = await toTypedSchema(schema).parse({
      name: 'rule',
      body: 'do this',
    })

    expect(result.value).toEqual({ name: 'rule', body: 'do this' })
    expect(result.errors).toEqual([])
  })

  it('returns a field error the form can show for invalid input', async () => {
    const result = await toTypedSchema(schema).parse({
      name: '',
      body: 'do this',
    })

    expect(result.value).toBeUndefined()
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toEqual({
      path: 'name',
      errors: [expect.any(String)],
    })
    expect(result.errors[0]?.errors[0]).toBeTruthy()
  })

  it('uses bracket notation for an invalid array element', async () => {
    const result = await toTypedSchema(
      z.object({
        tools: z.array(z.string().min(1)),
      }),
    ).parse({
      tools: [''],
    })

    expect(result.value).toBeUndefined()
    expect(result.errors).toEqual([
      {
        path: 'tools[0]',
        errors: [expect.any(String)],
      },
    ])
    expect(result.errors[0]?.errors[0]).toBeTruthy()
  })
})
