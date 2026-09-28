import { describe, expect, it } from 'vitest'
import safeFixEmphasis from '@/utils/markdown/safe-fix-emphasis'

describe('safe-fix-emphasis', () => {
  it('leaves inline-code and env-var underscores unchanged', () => {
    expect(safeFixEmphasis('Next: fire the `angi_lead` trigger for new leads.')).toBe(
      'Next: fire the `angi_lead` trigger for new leads.',
    )
    expect(safeFixEmphasis('Set ANGI_WEBHOOK_API_KEY in prod.')).toBe(
      'Set ANGI_WEBHOOK_API_KEY in prod.',
    )
  })

  it('leaves intra-word underscores in prose unchanged', () => {
    expect(safeFixEmphasis('use a_b in prose')).toBe('use a_b in prose')
  })

  it('leaves underscores inside a double-backtick span unchanged', () => {
    expect(safeFixEmphasis('see ``a_b`` please')).toBe('see ``a_b`` please')
  })

  it('appends a closing underscore for open italic emphasis', () => {
    expect(safeFixEmphasis('_italic text')).toBe('_italic text_')
  })

  it('appends a closing asterisk for open emphasis', () => {
    expect(safeFixEmphasis('*emphasis text')).toBe('*emphasis text*')
  })

  it('removes a trailing dangling underscore', () => {
    expect(safeFixEmphasis('hello _')).toBe('hello')
  })

  it('closes open italic when a snake_case identifier is also present', () => {
    expect(safeFixEmphasis('use snake_case and _italic')).toBe('use snake_case and _italic_')
  })

  it('closes open italic when inline code also contains an underscore', () => {
    expect(safeFixEmphasis('`a_b` and _italic')).toBe('`a_b` and _italic_')
  })

  it('leaves an unclosed streaming inline code span unchanged', () => {
    expect(safeFixEmphasis('fire `angi_lead')).toBe('fire `angi_lead')
  })

  it('returns identical text when there is nothing to fix', () => {
    expect(safeFixEmphasis('hello world')).toBe('hello world')
  })
})
