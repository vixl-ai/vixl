import type { WwwAuthenticateChallenge } from '@/types/mcp/www-authenticate-challenge'
import originOf from './origin-of'

const challenges = new Map<string, WwwAuthenticateChallenge>()

const keyOf = (url: string | URL): string => originOf(url)

export const recordLastOAuthChallenge = (
  url: string | URL,
  challenge: WwwAuthenticateChallenge,
): void => {
  challenges.set(keyOf(url), challenge)
}

export const getLastOAuthChallenge = (
  url: string | URL,
): WwwAuthenticateChallenge | undefined => challenges.get(keyOf(url))

export const resetLastOAuthChallengesForTests = (): void => {
  challenges.clear()
}
