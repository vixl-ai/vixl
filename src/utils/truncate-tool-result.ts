import { stripImageParts } from '@/services/harness/tool-result-image-parts'
import liftMcpToolImages from '@/services/mcp/lift-mcp-tool-images'

export default (result: unknown): unknown => {
  if (typeof result === 'string') {
    return result
  }

  if (!result || typeof result !== 'object') {
    return result
  }

  // Strip imageParts before persistence. Paths stay on sibling fields;
  // base64 never belongs in messages.jsonl.
  const withoutImageParts = stripImageParts(result)
  const { result: stripped } = liftMcpToolImages({
    result: withoutImageParts,
    source: 'tool-result',
  })
  return stripped
}
