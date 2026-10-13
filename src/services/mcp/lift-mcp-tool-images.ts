import type { StagedImage } from '@/types/harness/staged-image'

const PLACEHOLDER = '[image loaded into context]'

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const liftMcpToolImages = (args: {
  result: unknown
  source: string
}): { images: StagedImage[]; result: unknown; redacted: number } => {
  const images: StagedImage[] = []
  const seenData = new Set<string>()
  const clones = new WeakMap<object, unknown>()
  let redacted = 0

  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      const existing = clones.get(value)
      if (existing) {
        return existing
      }
      const next: unknown[] = []
      clones.set(value, next)
      for (const item of value) {
        next.push(walk(item))
      }
      return next
    }

    if (!isPlainObject(value)) {
      return value
    }

    const existing = clones.get(value)
    if (existing) {
      return existing
    }

    const next: Record<string, unknown> = {}
    clones.set(value, next)
    for (const key of Object.keys(value)) {
      next[key] = walk(value[key])
    }

    if (value.type === 'image' && Object.hasOwn(value, 'data')) {
      const data = value.data
      const mimeType = value.mimeType
      const alreadyStaged = typeof data === 'string' && seenData.has(data)
      if (
        typeof data === 'string' &&
        data.length > 0 &&
        typeof mimeType === 'string' &&
        mimeType.length > 0 &&
        !alreadyStaged
      ) {
        seenData.add(data)
        images.push({
          dataUrl: `data:${mimeType};base64,${data}`,
          mediaType: mimeType,
          source: args.source,
        })
      }
      next.data = PLACEHOLDER
      if (!alreadyStaged) {
        redacted += 1
      }
    }

    return next
  }

  return { images, result: walk(args.result), redacted }
}

export default liftMcpToolImages
