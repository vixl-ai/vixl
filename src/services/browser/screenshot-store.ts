import type { ToolImagePart } from '@/types/harness/tool-image-part'
import { writeTempBytes } from '@/services/vixl/vixl-tauri'

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary)
}

const saveScreenshot = async (
  bytes: Uint8Array,
  mimeType = 'image/png',
): Promise<ToolImagePart> => {
  const extension = mimeType === 'image/jpeg' ? 'jpg' : 'png'
  const { path } = await writeTempBytes({
    contentBase64: bytesToBase64(bytes),
    kind: 'screenshots',
    extension,
  })
  return {
    mimeType,
    path,
  }
}

export default saveScreenshot
