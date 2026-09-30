type OutputLimitTruncationInput = {
  maxOutputTokens?: number
  cutOffToolNames?: Iterable<string>
}

const describeOutputLimitTruncation = (input: OutputLimitTruncationInput): string => {
  const limitLabel =
    typeof input.maxOutputTokens === 'number' && input.maxOutputTokens > 0
      ? ` (${input.maxOutputTokens} tokens)`
      : ''
  const parts = [`The model reached its output limit${limitLabel} before finishing.`]
  const names = [
    ...new Set(
      [...(input.cutOffToolNames ?? [])].filter((name) => name.length > 0),
    ),
  ]
  if (names.length === 1) {
    parts.push(`${names[0]} was cut off and did not run.`)
  } else if (names.length > 1) {
    parts.push(`${names.join(', ')} were cut off and did not run.`)
  }
  parts.push('Raise max output in model options or ask for a shorter response.')
  return parts.join(' ')
}

export default describeOutputLimitTruncation
