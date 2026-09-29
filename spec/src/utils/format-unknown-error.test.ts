import { describe, expect, it } from 'vitest'
import formatUnknownError from '@/utils/format-unknown-error'

describe('formatUnknownError', () => {
  it('returns Error message', () => {
    expect(formatUnknownError(new Error('boom'))).toBe('boom')
  })

  it('returns string errors from Tauri', () => {
    expect(formatUnknownError('missing activeContext field')).toBe(
      'missing activeContext field',
    )
  })

  it('reads message from plain objects', () => {
    expect(formatUnknownError({ message: 'proxy failed' })).toBe('proxy failed')
  })

  it('reads error string from plain objects', () => {
    expect(formatUnknownError({ error: 'permission denied' })).toBe('permission denied')
  })

  it('reads nested error.message from plain objects', () => {
    expect(formatUnknownError({ error: { message: 'seatbelt denied' } })).toBe(
      'seatbelt denied',
    )
  })

  it('JSON-stringifies objects without message or error fields', () => {
    expect(formatUnknownError({ code: 'Io', details: 'broken pipe' })).toBe(
      '{"code":"Io","details":"broken pipe"}',
    )
  })

  it('falls back for empty values', () => {
    expect(formatUnknownError(null)).toBe('Unknown error')
    expect(formatUnknownError({})).toBe('Unknown error')
  })

  it('falls back for circular objects', () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    expect(formatUnknownError(circular)).toBe('Unknown error')
  })
})
