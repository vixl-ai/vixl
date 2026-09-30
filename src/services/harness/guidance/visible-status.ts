type VisibleStatusVerb = 'spawned' | 'steered' | 'finished'

const visibleStatusSubject = (verb: VisibleStatusVerb): string =>
  verb === 'finished' ? 'what finished' : `what was ${verb}`

const visibleStatus = (verb: VisibleStatusVerb): string =>
  `Leave a one-line visible status: ${visibleStatusSubject(verb)}, what is still running, what happens next.`

export default visibleStatus
