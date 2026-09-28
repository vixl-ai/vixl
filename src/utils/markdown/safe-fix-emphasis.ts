import { fixEmphasis } from '@markmend/core'

const INLINE_CODE = /(?<!`)(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g
const INTRA_WORD_UNDERSCORE = /(?<=\w)_(?=\w)/g

export default (content: string): string => {
  const masked = content
    .replace(INLINE_CODE, (span) => span.replaceAll('_', 'x'))
    .replace(INTRA_WORD_UNDERSCORE, 'x')
  const result = fixEmphasis(masked)
  if (result.startsWith(masked)) {
    return content + result.slice(masked.length)
  }
  if (masked.startsWith(result)) {
    return content.slice(0, result.length)
  }
  return content
}
