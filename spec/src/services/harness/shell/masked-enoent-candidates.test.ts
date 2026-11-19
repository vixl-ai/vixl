import { describe, expect, it } from 'vitest'
import maskedEnoentCandidates from '@/services/harness/shell/masked-enoent-candidates'

const PROJECT_ROOT = '/project'
const KEY = '/Users/tester/.ssh/id_ed25519.pub'

describe('maskedEnoentCandidates', () => {
  it('extracts the key path from an ssh-keygen missing-key error', () => {
    const line = `error: Couldn't load public key ${KEY}: No such file or directory?`
    expect(maskedEnoentCandidates(line, PROJECT_ROOT)).toEqual([KEY])
  })

  it('extracts the quoted path from a Node ENOENT error', () => {
    const line = `Error: ENOENT: no such file or directory, open '${KEY}'`
    expect(maskedEnoentCandidates(line, PROJECT_ROOT)).toEqual([KEY])
  })

  it('ignores paths under the project root', () => {
    const line = `Error: ENOENT: no such file or directory, open '/project/missing.ts'`
    expect(maskedEnoentCandidates(line, PROJECT_ROOT)).toEqual([])
  })

  it('ignores lines without a missing-file error', () => {
    expect(maskedEnoentCandidates(`loaded ${KEY}`, PROJECT_ROOT)).toEqual([])
  })

  it('scans multi-line output and deduplicates candidates', () => {
    const text = [
      'hint: signing failed',
      `error: Couldn't load public key ${KEY}: No such file or directory?`,
      `Error: ENOENT: no such file or directory, open '${KEY}'`,
      'fatal: failed to write commit object',
    ].join('\n')
    expect(maskedEnoentCandidates(text, PROJECT_ROOT)).toEqual([KEY])
  })

  it('strips trailing punctuation from candidates', () => {
    const line = `cat: ${KEY}.: No such file or directory`
    expect(maskedEnoentCandidates(line, PROJECT_ROOT)).toEqual([KEY])
  })

  it('returns nothing for blank output', () => {
    expect(maskedEnoentCandidates('', PROJECT_ROOT)).toEqual([])
    expect(maskedEnoentCandidates('\n', PROJECT_ROOT)).toEqual([])
  })
})