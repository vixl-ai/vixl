import type { UIMessage } from 'ai'
import type { HydrateAccumulator } from './hydrate-timeline-builder'

export const pushHarnessWakeUserMessage = (
  acc: HydrateAccumulator,
  flushTurn: () => void,
  input: {
    id: string
    parts: UIMessage['parts']
    createdAt?: string
  },
): void => {
  flushTurn()
  acc.nextMessages.push({
    id: input.id,
    role: 'user',
    parts: input.parts,
    metadata: {
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      harnessWake: true,
    },
  })
}
