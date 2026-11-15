import { describe, expect, it } from 'vitest'
import {
  parseImageDimensions,
  parseImageDimensionsFromBase64,
  parseImageDimensionsFromBytes,
} from '@/utils/image-dimensions'

const ascii = (text: string): number[] =>
  Array.from(text).map((char) => char.charCodeAt(0))

const base64 = (bytes: number[]): string => {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary)
}

const png = (width: number, height: number): number[] => [
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
  0x08, 0x06, 0x00, 0x00, 0x00,
]

const gif = (width: number, height: number): number[] => [
  ...ascii('GIF89a'),
  width & 0xff,
  (width >> 8) & 0xff,
  height & 0xff,
  (height >> 8) & 0xff,
  0x00,
]

const webpVp8 = (width: number, height: number): number[] => [
  ...ascii('RIFF'),
  0x00, 0x00, 0x00, 0x00,
  ...ascii('WEBP'),
  ...ascii('VP8 '),
  0x14, 0x00, 0x00, 0x00,
  0x10, 0x00, 0x00,
  0x9d, 0x01, 0x2a,
  width & 0xff,
  (width >> 8) & 0x3f,
  height & 0xff,
  (height >> 8) & 0x3f,
]

const webpVp8l = (width: number, height: number): number[] => {
  // VP8L stores 32 little-endian bits: width-1 in bits 0-13, height-1 in 14-27.
  const bits = (width - 1) | ((height - 1) << 14)
  return [
    ...ascii('RIFF'),
    0x00, 0x00, 0x00, 0x00,
    ...ascii('WEBP'),
    ...ascii('VP8L'),
    0x0a, 0x00, 0x00, 0x00,
    0x2f,
    bits & 0xff,
    (bits >> 8) & 0xff,
    (bits >> 16) & 0xff,
    (bits >>> 24) & 0xff,
  ]
}

const webpVp8x = (width: number, height: number): number[] => {
  const w = width - 1
  const h = height - 1
  return [
    ...ascii('RIFF'),
    0x00, 0x00, 0x00, 0x00,
    ...ascii('WEBP'),
    ...ascii('VP8X'),
    0x0a, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff,
    h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff,
  ]
}

const jpeg = (width: number, height: number): number[] => [
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x10,
  ...ascii('JFIF\x00'),
  0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  0xff, 0xdb, 0x00, 0x02,
  0xff, 0xc0, 0x00, 0x11, 0x08,
  (height >> 8) & 0xff, height & 0xff,
  (width >> 8) & 0xff, width & 0xff,
  0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x0c,
]

describe('parseImageDimensionsFromBytes', () => {
  it('reads PNG IHDR', () => {
    expect(parseImageDimensionsFromBytes(Uint8Array.from(png(1024, 768)))).toEqual({
      width: 1024,
      height: 768,
    })
  })

  it('reads GIF little-endian logical screen descriptor', () => {
    expect(parseImageDimensionsFromBytes(Uint8Array.from(gif(256, 512)))).toEqual({
      width: 256,
      height: 512,
    })
  })

  it('reads WebP VP8 lossy', () => {
    expect(
      parseImageDimensionsFromBytes(Uint8Array.from(webpVp8(640, 480))),
    ).toEqual({ width: 640, height: 480 })
  })

  it('reads WebP VP8L lossless', () => {
    expect(
      parseImageDimensionsFromBytes(Uint8Array.from(webpVp8l(100, 200))),
    ).toEqual({ width: 100, height: 200 })
  })

  it('reads WebP VP8X extended', () => {
    expect(
      parseImageDimensionsFromBytes(Uint8Array.from(webpVp8x(2048, 1536))),
    ).toEqual({ width: 2048, height: 1536 })
  })

  it('scans JPEG segments past APPn/DHT to the SOF marker', () => {
    expect(
      parseImageDimensionsFromBytes(Uint8Array.from(jpeg(1846, 2032))),
    ).toEqual({ width: 1846, height: 2032 })
  })

  it('returns null for garbage and truncated streams', () => {
    expect(parseImageDimensionsFromBytes(new Uint8Array([1, 2, 3]))).toBeNull()
    expect(
      parseImageDimensionsFromBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])),
    ).toBeNull()
  })
})

describe('parseImageDimensionsFromBase64 / parseImageDimensions', () => {
  it('parses raw base64 payloads', () => {
    expect(parseImageDimensionsFromBase64(base64(png(1200, 900)))).toEqual({
      width: 1200,
      height: 900,
    })
  })

  it('parses data URL payloads with padding beyond the header', () => {
    const source = `data:image/png;base64,${base64(jpeg(300, 192))}${'A'.repeat(4_000)}`
    expect(parseImageDimensions(source)).toEqual({ width: 300, height: 192 })
  })

  it('returns null for non-image data and malformed input', () => {
    expect(parseImageDimensions('')).toBeNull()
    expect(parseImageDimensions('not-base64!!!')).toBeNull()
    expect(parseImageDimensions('https://example.com/a.png')).toBeNull()
    expect(parseImageDimensions('data:image/png,%89PNG-truncated')).toBeNull()
  })

  it('handles a large padded JPEG payload via bounded prefix decoding', () => {
    const source = base64(jpeg(1600, 900)) + 'B'.repeat(400_000)
    expect(parseImageDimensions(source)).toEqual({ width: 1600, height: 900 })
  })
})
