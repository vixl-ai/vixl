import { describe, expect, it } from 'vitest'
import {
  parseSshProjectRoot,
  parseSshRunsAsLine,
  resolveSshMoveRoot,
  sshCopyRemotePath,
  sshRunsAsLine,
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

  it('parses the remote runs-as line back to user and host', () => {
    expect(parseSshRunsAsLine(sshRunsAsLine(root))).toEqual({
      user: 'aidanhibbard',
      hostname: 'eva.local',
    })
    expect(parseSshRunsAsLine('Runs on this Mac')).toBeNull()
  })
})

describe('resolveSshMoveRoot', () => {
  const current = 'ssh://aidanhibbard@eva.local/home/aidanhibbard'

  it('joins a workspace-relative folder onto the remote root', () => {
    expect(resolveSshMoveRoot(current, 'src/llama.cpp')).toBe(
      'ssh://aidanhibbard@eva.local/home/aidanhibbard/src/llama.cpp',
    )
  })

  it('treats an absolute path as a path on the current host', () => {
    expect(resolveSshMoveRoot(current, '/home/aidanhibbard/src/llama.cpp')).toBe(
      'ssh://aidanhibbard@eva.local/home/aidanhibbard/src/llama.cpp',
    )
  })

  it('keeps an explicit ssh uri, including a non-default port', () => {
    expect(
      resolveSshMoveRoot(
        current,
        'ssh://aidanhibbard@eva.local:2222/home/aidanhibbard/src/llama.cpp',
      ),
    ).toBe('ssh://aidanhibbard@eva.local:2222/home/aidanhibbard/src/llama.cpp')
  })

  it('refuses a destination of /', () => {
    expect(() => resolveSshMoveRoot(current, '/')).toThrow('Opening / on eva.local is refused.')
    expect(() => resolveSshMoveRoot(`${current}/proj`, '../../..')).toThrow(
      'Opening / on eva.local is refused.',
    )
  })
})
