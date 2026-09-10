const inputExamplesFromMeta = (meta: Record<string, unknown> | null | undefined) => {
  if (meta && typeof meta === 'object' && 'inputExamples' in meta) {
    return meta.inputExamples ?? null
  }
  return null
}

export default inputExamplesFromMeta
