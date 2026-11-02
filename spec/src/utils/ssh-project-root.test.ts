import { describe, expect, it } from 'vitest'
import {
  parseSshProjectRoot,
  sshCopyRemotePath,
  sshSidebarLabel,
} from '@/utils/ssh-project-root'

describe('parseSshProjectRoot', () => {
  it('parses user, host, port, and remote path', () => {
    expect(parseSshProjectRoot('ssh://aidanhibbard@eva.local:2222/home/aidanhibbard/proj')).toEqual({
      user: 'aidanhibbard',
      hostname: 'eva.local',
      port: 2222,
      remotePath: '/home/aidanhibbard/proj',
    })
  })

  it('refuses opening remote /', () => {
    expect(() => parseSshProjectRoot('ssh://aidanhibbard@eva.local/')).toThrow(
      'Opening / on eva.local is refused.',
    )
  })
})

describe('ssh labels', () => {
  const root = parseSshProjectRoot('ssh://aidanhibbard@eva.local/home/aidanhibbard/proj')

  it('builds the sidebar label from the stored URI', () => {
    expect(sshSidebarLabel(root)).toBe('aidanhibbard@eva.local:/home/aidanhibbard/proj')
  })

  it('copies user@host:/absolute/path while disconnected', () => {
    expect(sshCopyRemotePath(root, 'src/lib.rs')).toBe(
      'aidanhibbard@eva.local:/home/aidanhibbard/proj/src/lib.rs',
    )
    expect(sshCopyRemotePath(root, '.')).toBe(
      'aidanhibbard@eva.local:/home/aidanhibbard/proj',
    )
  })
})
