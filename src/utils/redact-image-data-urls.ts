import { estimateImageTokensFromSource } from './estimate-image-tokens'

const IMAGE_DATA_URL_SOURCE = String.raw`data:image/[\w.+-]+(?:;[\w.+-]+=[^,;"'\s]*)*;base64,[A-Za-z0-9+/=]+`

export const createImageDataURLMatcher = (): RegExp =>
  new RegExp(IMAGE_DATA_URL_SOURCE, 'gi')

export const redactImageDataURLs = (
  text: string,
  label: (dataUrl: string) => string = () => '[image]',
): string => {
  if (!text.includes('data:image')) {
    return text
  }
  return text.replace(createImageDataURLMatcher(), (match) => label(match))
}

/**
 * Replace base64 image payloads embedded in serialized text (tool results,
 * JSON.stringify'd parts) with short labels, returning the pixel-based token
 * cost of every image removed so callers can add it back as a bounded count.
 */
export const redactImageDataURLsWithTokens = (
  text: string,
): { text: string; imageTokens: number } => {
  if (!text.includes('data:image')) {
    return { text, imageTokens: 0 }
  }
  let imageTokens = 0
  const out = text.replace(createImageDataURLMatcher(), (match) => {
    imageTokens += estimateImageTokensFromSource(match)
    return '[image]'
  })
  return { text: out, imageTokens }
}
