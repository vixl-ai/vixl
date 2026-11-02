import { describe, expect, it } from 'vitest'
import {
  buildSshConnectRequest,
  validateSshDestination,
} from '@/utils/ssh-destination'

describe('validateSshDestination', () => {
  it('refuses a blank host without starting ssh', () => {
    expect(validateSshDestination('')).toEqual({
      title: 'Enter a host.',
      body: 'Type an alias such as eva, or a user and host such as aidanhibbard@eva.local.',
    })
  })

  it('refuses a pasted ssh command', () => {
    const error = validateSshDestination('ssh aidanhibbard@eva.local -p 22')
    expect(error?.title).toBe('That is an ssh command, not a host.')
  })

  it('refuses a password in the host field', () => {
    const error = validateSshDestination('aidanhibbard:secret@eva.local')
    expect(error?.title).toBe('Remove the password from the host field.')
  })
})

describe('buildSshConnectRequest', () => {
  it('adds passwordOnly only on that connect request', () => {
    const request = buildSshConnectRequest({
      destination: 'eva',
      user: 'aidanhibbard',
      port: 22,
      passwordOnly: true,
    })
    expect(request).toEqual({
      destination: 'eva',
      user: 'aidanhibbard',
      port: 22,
      passwordOnly: true,
    })
    expect(JSON.stringify(request)).not.toContain('IdentityFile')
    expect(JSON.stringify(request)).not.toMatch(/\.ssh\/config/)
  })

  it('omits passwordOnly when the checkbox is off', () => {
    expect(
      buildSshConnectRequest({
        destination: 'eva',
        passwordOnly: false,
      }),
    ).toEqual({ destination: 'eva' })
  })
})
