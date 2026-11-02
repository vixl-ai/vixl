import { describe, expect, it } from 'vitest'
import {
  buildSshConnectRequest,
  sshIdentityExample,
  validateSshDestination,
  validateSshUser,
} from '@/utils/ssh-destination'

describe('validateSshDestination', () => {
  it('refuses a blank host without starting ssh', () => {
    expect(validateSshDestination('')).toEqual({
      title: 'Enter a host.',
      body: 'Type an alias such as appleseed, or a user and host such as johnny@appleseed.example.',
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

describe('validateSshUser', () => {
  it('asks for an account instead of using this computer', () => {
    expect(validateSshUser('appleseed.example', '')).toEqual({
      title: 'Enter a user.',
      body: 'Type the account on that host, such as johnny. Vixl does not use the account on this computer.',
    })
    expect(validateSshUser('appleseed.example', 'johnny')).toBeNull()
    expect(validateSshUser('johnny@appleseed.example', '')).toBeNull()
  })
})

describe('sshIdentityExample', () => {
  it('uses a johnny path for the current system', () => {
    expect(sshIdentityExample('MacIntel')).toBe('/Users/johnny/.ssh/id_ed25519')
    expect(sshIdentityExample('Linux x86_64')).toBe('/home/johnny/.ssh/id_ed25519')
    expect(sshIdentityExample('Win32')).toBe('C:\\Users\\johnny\\.ssh\\id_ed25519')
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
