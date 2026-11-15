export interface ImageDimensions {
  width: number
  height: number
}

// JPEG SOF markers can sit past EXIF/APPn segments, but always early in the
// stream. Decoding the full multi-megabyte base64 payload just to read pixel
// dimensions would dominate compaction estimates, so scan a bounded prefix.
const HEADER_SCAN_BYTES = 65_536
const SNIFF_BYTES = 32

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const decodeBase64Prefix = (base64: string, maxBytes: number): Uint8Array => {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < base64.length && bytes.length < maxBytes; i += 1) {
    const code = BASE64_ALPHABET.indexOf(base64.charAt(i))
    if (code < 0) {
      continue
    }
    buffer = (buffer << 6) | code
    bits += 6
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }
  return Uint8Array.from(bytes)
}

const readU16BE = (b: Uint8Array, i: number): number =>
  (b[i] ?? 0) * 256 + (b[i + 1] ?? 0)

const readU16LE = (b: Uint8Array, i: number): number =>
  (b[i] ?? 0) + (b[i + 1] ?? 0) * 256

const readU32BE = (b: Uint8Array, i: number): number =>
  ((b[i] ?? 0) * 2 ** 24) +
  ((b[i + 1] ?? 0) << 16) +
  ((b[i + 2] ?? 0) << 8) +
  (b[i + 3] ?? 0)

const readU24LE = (b: Uint8Array, i: number): number =>
  (b[i] ?? 0) + (b[i + 1] ?? 0) * 256 + (b[i + 2] ?? 0) * 65_536

const MAX_DIMENSION = 100_000

const dimensions = (width: number, height: number): ImageDimensions | null => {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_DIMENSION ||
    height > MAX_DIMENSION
  ) {
    return null
  }
  return { width, height }
}

const matchesAscii = (b: Uint8Array, offset: number, text: string): boolean => {
  for (let i = 0; i < text.length; i += 1) {
    if (b[offset + i] !== text.charCodeAt(i)) {
      return false
    }
  }
  return true
}

const parsePng = (b: Uint8Array): ImageDimensions | null => {
  if (b.length < 24 || !matchesAscii(b, 0, '\x89PNG\r\n\x1a\n')) {
    return null
  }
  if (!matchesAscii(b, 12, 'IHDR')) {
    return null
  }
  return dimensions(readU32BE(b, 16), readU32BE(b, 20))
}

const parseGif = (b: Uint8Array): ImageDimensions | null => {
  if (b.length < 10 || !matchesAscii(b, 0, 'GIF8')) {
    return null
  }
  return dimensions(readU16LE(b, 6), readU16LE(b, 8))
}

const parseWebp = (b: Uint8Array): ImageDimensions | null => {
  if (b.length < 20 || !matchesAscii(b, 0, 'RIFF') || !matchesAscii(b, 8, 'WEBP')) {
    return null
  }
  if (matchesAscii(b, 12, 'VP8 ')) {
    if (b.length < 30) {
      return null
    }
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) {
      return null
    }
    return dimensions(readU16LE(b, 26) & 0x3fff, readU16LE(b, 28) & 0x3fff)
  }
  if (matchesAscii(b, 12, 'VP8L')) {
    if (b.length < 25 || b[20] !== 0x2f) {
      return null
    }
    const bits =
      (b[21] ?? 0) +
      (b[22] ?? 0) * 256 +
      (b[23] ?? 0) * 65_536 +
      (b[24] ?? 0) * 2 ** 24
    return dimensions((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (matchesAscii(b, 12, 'VP8X')) {
    if (b.length < 30) {
      return null
    }
    return dimensions(readU24LE(b, 24) + 1, readU24LE(b, 27) + 1)
  }
  return null
}

const parseJpeg = (b: Uint8Array): ImageDimensions | null => {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) {
    return null
  }
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i += 1
      continue
    }
    const marker = b[i + 1] ?? 0
    if (marker === 0xff) {
      i += 1
      continue
    }
    // Standalone markers without a payload length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2
      continue
    }
    const isSof =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    if (isSof) {
      return dimensions(readU16BE(b, i + 7), readU16BE(b, i + 5))
    }
    if (marker === 0xda) {
      return null
    }
    const segmentLength = readU16BE(b, i + 2)
    if (segmentLength < 2) {
      return null
    }
    i += 2 + segmentLength
  }
  return null
}

export const parseImageDimensionsFromBytes = (
  bytes: Uint8Array,
): ImageDimensions | null =>
  parsePng(bytes) ??
  parseGif(bytes) ??
  parseWebp(bytes) ??
  parseJpeg(bytes)

export const parseImageDimensionsFromBase64 = (
  base64: string,
): ImageDimensions | null => {
  if (!base64) {
    return null
  }
  const sniff = decodeBase64Prefix(base64, SNIFF_BYTES)
  if (!(sniff[0] === 0xff && sniff[1] === 0xd8)) {
    return parseImageDimensionsFromBytes(sniff)
  }
  if (base64.length <= 200) {
    return parseImageDimensionsFromBytes(sniff)
  }
  const payload =
    base64.length > HEADER_SCAN_BYTES * 2
      ? base64.slice(0, Math.ceil((HEADER_SCAN_BYTES / 3) * 4) + 4)
      : base64
  return parseImageDimensionsFromBytes(decodeBase64Prefix(payload, HEADER_SCAN_BYTES))
}

const parseDataUrl = (dataUrl: string): ImageDimensions | null => {
  const comma = dataUrl.indexOf(',')
  if (comma < 0) {
    return null
  }
  const meta = dataUrl.slice(0, comma)
  if (meta.includes(';base64')) {
    return parseImageDimensionsFromBase64(dataUrl.slice(comma + 1))
  }
  return null
}

/**
 * Reads pixel dimensions from the header of a base64 payload or data URL.
 * Supports PNG, GIF, WebP (VP8/VP8L/VP8X) and JPEG. Returns null when the
 * source is not a parseable image (remote URLs, exotic encodings, truncation).
 */
export const parseImageDimensions = (
  source: string,
): ImageDimensions | null => {
  if (!source) {
    return null
  }
  if (source.startsWith('data:')) {
    return parseDataUrl(source)
  }
  return parseImageDimensionsFromBase64(source)
}
