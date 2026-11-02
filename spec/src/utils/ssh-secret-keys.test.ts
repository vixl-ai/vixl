import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  webviewMustNotCallGenericSecrets,
} from '@/utils/ssh-secret-keys'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const readSrc = (relative: string): string =>
  readFileSync(resolve(repoRoot, relative), 'utf8')

describe('webviewMustNotCallGenericSecrets', () => {
  it('blocks the ssh password and passphrase prefixes', () => {
    expect(() =>
      webviewMustNotCallGenericSecrets('vixl:ssh-password:aidanhibbard@eva.local:22'),
    ).toThrow(/SSH secrets cannot be read or written through the generic secret commands/)
    expect(() =>
      webviewMustNotCallGenericSecrets('vixl:ssh-passphrase:/home/aidanhibbard/.ssh/id_ed25519'),
    ).toThrow(/SSH secrets cannot be read or written through the generic secret commands/)
  })

  it('allows other vault keys', () => {
    expect(() => webviewMustNotCallGenericSecrets('vixl:provider:openai')).not.toThrow()
  })

  it('keeps ssh secret UI off the generic helpers', () => {
    const sources = [
      readSrc('src/services/ssh/ssh-secrets.ts'),
      readSrc('src/composables/use-ssh-session.ts'),
      readSrc('src/composables/ssh-session/connect.ts'),
      readSrc('src/composables/ssh-session/events.ts'),
      readSrc('src/composables/ssh-session/fleet.ts'),
      readSrc('src/composables/ssh-session/folder.ts'),
      readSrc('src/composables/ssh-session/prompts.ts'),
      readSrc('src/composables/ssh-session/state.ts'),
      readSrc('src/composables/ssh-secrets-section.ts'),
    ]
    for (const source of sources) {
      expect(source).not.toMatch(/\bgetSecret\b/)
      expect(source).not.toMatch(/\bsetSecret\b/)
      expect(source).not.toMatch(/\bdeleteSecret\b/)
      expect(source).not.toMatch(/get_secret/)
      expect(source).not.toMatch(/set_secret/)
      expect(source).not.toMatch(/delete_secret/)
    }
  })
})
