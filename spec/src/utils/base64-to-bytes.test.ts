import { describe, expect, it } from 'vitest'
import base64ToBytes from '@/utils/base64-to-bytes'
import bytesToDataUrl from '@/utils/bytes-to-data-url'

const base64Of = (bytes: Uint8Array): string => {
  const dataUrl = bytesToDataUrl(bytes, 'application/octet-stream')
  return dataUrl.slice(dataUrl.indexOf(',') + 1)
}

describe('base64-to-bytes', () => {
  it('decodes binary payloads', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255])
    expect(Array.from(base64ToBytes(base64Of(bytes)))).toEqual(Array.from(bytes))
  })

  it('decodes utf-8 text payloads', () => {
    const bytes = new TextEncoder().encode('data: {"delta":"hi"}\n\n')
    expect(Array.from(base64ToBytes(base64Of(bytes)))).toEqual(Array.from(bytes))
  })

  it('returns an empty array for empty input', () => {
    expect(base64ToBytes('').length).toBe(0)
  })

  it('throws on invalid base64', () => {
    expect(() => base64ToBytes('not base64!')).toThrow('Invalid character')
  })
})