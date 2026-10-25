import { describe, expect, it } from 'vitest'
import { shellDisplayTitle } from '@/utils/shell-display-title'

describe('shellDisplayTitle', () => {
  it('prefers a non-empty description over command', () => {
    expect(
      shellDisplayTitle({
        description: 'Start the server',
        command: 'npm run dev',
      }),
    ).toBe('Start the server')
  })

  it('uses command when description is missing', () => {
    expect(shellDisplayTitle({ command: 'npm run dev' })).toBe('npm run dev')
  })

  it('uses command when description is blank', () => {
    expect(
      shellDisplayTitle({
        description: '   ',
        command: 'npm run dev',
      }),
    ).toBe('npm run dev')
  })
})
