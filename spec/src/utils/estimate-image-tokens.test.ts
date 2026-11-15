import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_TOKENS,
  UNKNOWN_IMAGE_TOKENS,
  estimateImageTokensFromBytes,
  estimateImageTokensFromSource,
} from '@/utils/estimate-image-tokens'

const ascii = (text: string): number[] =>
  Array.from(text).map((char) => char.charCodeAt(0))

const base64 = (bytes: number[]): string => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const pngHeader = (width: number, height: number): number[] => [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d,
  ...ascii('IHDR'),
  (width >>> 24) & 0xff,
  (width >> 16) & 0xff,
  (width >> 8) & 0xff,
  width & 0xff,
  (height >>> 24) & 0xff,
  (height >> 16) & 0xff,
  (height >> 8) & 0xff,
  height & 0xff,
]

const pngDataUrl = (width: number, height: number, pad = 0): string =>
  `data:image/png;base64,${base64(pngHeader(width, height))}${'A'.repeat(pad)}`

describe('estimateImageTokensFromSource', () => {
  it('uses the patch formula for small images', () => {
    // 100x100 -> ceil(100/28)^2 = 4*4 = 16
    expect(estimateImageTokensFromSource(pngDataUrl(100, 100))).toBe(16)
  })

  it('caps large images at MAX_IMAGE_TOKENS regardless of payload bytes', () => {
    const capped = estimateImageTokensFromSource(pngDataUrl(1846, 2032))
    expect(capped).toBe(MAX_IMAGE_TOKENS)
    // 2MB of base64 for the same image must not change the estimate.
    expect(estimateImageTokensFromSource(pngDataUrl(1846, 2032, 2_000_000))).toBe(
      MAX_IMAGE_TOKENS,
    )
  })

  it('falls back to UNKNOWN_IMAGE_TOKENS for unparseable sources', () => {
    expect(estimateImageTokensFromSource('')).toBe(UNKNOWN_IMAGE_TOKENS)
    expect(estimateImageTokensFromSource('!!!not base64!!!')).toBe(
      UNKNOWN_IMAGE_TOKENS,
    )
    expect(estimateImageTokensFromSource('A'.repeat(300_000))).toBe(
      UNKNOWN_IMAGE_TOKENS,
    )
  })
})

describe('estimateImageTokensFromBytes', () => {
  it('parses binary sources without base64', () => {
    expect(estimateImageTokensFromBytes(Uint8Array.from(pngHeader(224, 224)))).toBe(
      64,
    )
  })

  it('returns UNKNOWN for arbitrary bytes', () => {
    expect(estimateImageTokensFromBytes(new Uint8Array([7, 7, 7]))).toBe(
      UNKNOWN_IMAGE_TOKENS,
    )
  })
})
