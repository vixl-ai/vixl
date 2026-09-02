import { describe, expect, it } from 'vitest'
import {
  detectSandboxRuntimeDenial,
  isSandboxDeviceRuntimeDenial,
  isSandboxFilesystemRuntimeDenial,
  isSandboxNetworkRuntimeDenial,
  isSandboxSpawnError,
  sandboxRuntimeDenialError,
} from '@/services/harness/shell/sandbox-denial'

const FSTAB_ONLY = `# /etc/fstab: static file system information
UUID=11111111-2222-3333-4444-555555555555 / ext4 errors=remount-ro 0 1
UUID=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee /boot/efi vfat umask=0077 0 1
`

const GIT_STATUS = `On branch main
Your branch is up to date with 'origin/main'.

nothing to commit, working tree clean
`

describe('detectSandboxRuntimeDenial', () => {
  it('does not classify fstab-only output as a sandbox denial', () => {
    expect(detectSandboxRuntimeDenial(FSTAB_ONLY)).toBeNull()
    expect(
      detectSandboxRuntimeDenial(FSTAB_ONLY, { command: 'cat /etc/fstab' }),
    ).toBeNull()
  })

  it('classifies lsblk not available even when fstab is also printed', () => {
    const output = `lsblk not available
${FSTAB_ONLY}`
    expect(detectSandboxRuntimeDenial(output)).toBe('devices')
    expect(detectSandboxRuntimeDenial('missing lsblk; using /etc/fstab')).toBe(
      'devices',
    )
    expect(
      detectSandboxRuntimeDenial('lsblk: command not found', {
        command: 'lsblk',
      }),
    ).toBe('devices')
    expect(detectSandboxRuntimeDenial('bash: lsblk: not found')).toBe('devices')
  })

  it('classifies bwrap tmpfs[/newroot] and /dev as tmpfs', () => {
    expect(detectSandboxRuntimeDenial('rootfs tmpfs[/newroot] rw')).toBe(
      'devices',
    )
    expect(
      detectSandboxRuntimeDenial(
        'tmpfs on /dev type tmpfs (rw,nosuid,size=65536k,mode=755)',
      ),
    ).toBe('devices')
    expect(
      detectSandboxRuntimeDenial('none on /newroot type tmpfs (rw)'),
    ).toBe('devices')
  })

  it('classifies ENOENT on /dev/disk, /sys/block, and /dev', () => {
    expect(
      detectSandboxRuntimeDenial(
        "ls: cannot access '/dev/disk': No such file or directory",
      ),
    ).toBe('devices')
    expect(
      detectSandboxRuntimeDenial(
        'cat: /sys/block: No such file or directory',
      ),
    ).toBe('devices')
    expect(
      detectSandboxRuntimeDenial("ls: cannot access '/dev': No such file or directory"),
    ).toBe('devices')
    expect(
      detectSandboxRuntimeDenial('ENOENT: no such file or directory, open /dev/disk/by-uuid'),
    ).toBe('devices')
  })

  it('classifies empty by-uuid probes and header-only lsblk (exit 0 trap)', () => {
    expect(
      detectSandboxRuntimeDenial('NAME MAJ:MIN RM SIZE RO TYPE MOUNTPOINTS\n'),
    ).toBe('devices')
    expect(
      detectSandboxRuntimeDenial('', { command: 'lsblk -o NAME,SIZE,TYPE,MOUNTPOINT' }),
    ).toBe('devices')
    expect(
      detectSandboxRuntimeDenial('\n', { command: 'ls /dev/disk/by-uuid' }),
    ).toBe('devices')
    expect(
      detectSandboxRuntimeDenial('ls: cannot access /dev/disk/by-uuid: empty'),
    ).toBe('devices')
    expect(isSandboxDeviceRuntimeDenial('devices')).toBe(true)
    expect(isSandboxDeviceRuntimeDenial('filesystem')).toBe(false)
    expect(isSandboxNetworkRuntimeDenial('network')).toBe(true)
    expect(isSandboxFilesystemRuntimeDenial('filesystem')).toBe(true)
  })

  it('classifies existing EPERM filesystem denials', () => {
    expect(
      detectSandboxRuntimeDenial(
        "Error: EPERM: operation not permitted, lstat '/Users/aidan/secret'",
      ),
    ).toBe('filesystem')
    expect(
      detectSandboxRuntimeDenial('cp: Operation not permitted'),
    ).toBe('filesystem')
  })

  it('classifies DNS and connect network denials', () => {
    expect(
      detectSandboxRuntimeDenial('curl: (6) Could not resolve host: github.com'),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial('error connecting to api.github.com:443'),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial('ping: connect: Network is unreachable'),
    ).toBe('network')
  })

  it('does not fire on a plain successful git status', () => {
    expect(detectSandboxRuntimeDenial(GIT_STATUS)).toBeNull()
    expect(
      detectSandboxRuntimeDenial(GIT_STATUS, { command: 'git status' }),
    ).toBeNull()
    expect(
      detectSandboxRuntimeDenial('', { command: 'git status --short' }),
    ).toBeNull()
  })

  it('classifies header-only ss listener tables as a network denial (exit 0 trap)', () => {
    expect(
      detectSandboxRuntimeDenial(
        'State Recv-Q Send-Q Local Address:Port Peer Address:Port\n',
        { command: 'ss -tlnp' },
      ),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial(
        'Netid State Recv-Q Send-Q Local Address:Port Peer Address:Port\n',
        { command: 'ss -ln' },
      ),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial(
        'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port\n',
        { command: 'ss -tln' },
      ),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial(
        'State Recv-Q Send-Q Local Address:Port Peer Address:Port\n',
        { command: 'ss -ltnp' },
      ),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial('', { command: 'ss -tlnp' }),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial(
        `State Recv-Q Send-Q Local Address:Port Peer Address:Port
LISTEN 0 128 0.0.0.0:22 0.0.0.0:*`,
        { command: 'ss -tlnp' },
      ),
    ).toBeNull()
  })

  it('classifies sandboxed curl connect-fail as a network denial', () => {
    expect(
      detectSandboxRuntimeDenial(
        'curl: (7) Failed to connect to 127.0.0.1 port 8096 after 0 ms: Could not connect to server',
        {
          command: 'curl -sS http://127.0.0.1:8096/System/Info',
          sandboxed: true,
        },
      ),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial(
        'curl: (7) Failed to connect to localhost port 8096: Connection refused',
        {
          command: 'curl http://localhost:8096',
          sandboxed: true,
          allowNetwork: true,
        },
      ),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial('wget: unable to connect to remote host: Connection refused', {
        command: 'wget -qO- http://127.0.0.1:8096',
        sandboxed: true,
      }),
    ).toBe('network')
  })

  it('does not treat unsandboxed curl connection refused as a sandbox jail', () => {
    expect(
      detectSandboxRuntimeDenial(
        'curl: (7) Failed to connect to 127.0.0.1 port 8096: Connection refused',
        {
          command: 'curl http://127.0.0.1:8096',
          sandboxed: false,
        },
      ),
    ).toBeNull()
  })

  it('classifies sandboxed npm registry failures as network when network is denied', () => {
    const npmAudit = `npm warn audit request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
npm error audit endpoint returned an error`

    expect(
      detectSandboxRuntimeDenial(npmAudit, {
        command: 'npm install',
        sandboxed: true,
        allowNetwork: false,
      }),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial('npm error network', {
        command: 'npm install',
        sandboxed: true,
        allowNetwork: false,
      }),
    ).toBe('network')
  })

  it('does not treat unsandboxed npm failures as a sandbox jail', () => {
    const npmAudit = `npm warn audit request to https://registry.npmjs.org/-/npm/v1/security/advisories/bulk failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org
npm error audit endpoint returned an error`

    expect(
      detectSandboxRuntimeDenial(npmAudit, {
        command: 'npm install',
        sandboxed: false,
        allowNetwork: false,
      }),
    ).toBeNull()
    expect(
      detectSandboxRuntimeDenial(npmAudit, {
        command: 'npm install',
        sandboxed: true,
        allowNetwork: true,
      }),
    ).toBeNull()
    expect(
      detectSandboxRuntimeDenial('npm error network', {
        command: 'npm install',
        sandboxed: false,
      }),
    ).toBeNull()
  })

  it('classifies silent curl localhost as a network denial (exit 0 trap)', () => {
    expect(
      detectSandboxRuntimeDenial('', {
        command: 'curl -sS http://localhost:8096/System/Info',
      }),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial('\n', {
        command: 'curl http://127.0.0.1:8096',
      }),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial('JSON-tool failed', {
        command: 'wget -qO- https://localhost:8096',
      }),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial('Jellyfin not on localhost', {
        command: 'curl http://127.0.0.1:8096',
      }),
    ).toBe('network')
    expect(
      detectSandboxRuntimeDenial('not available', {
        command: 'curl :8096/health',
      }),
    ).toBe('network')
  })

  it('classifies empty find/ls of out-of-workspace paths as filesystem', () => {
    expect(
      detectSandboxRuntimeDenial('', {
        command: 'find /srv/jellyfin -name "*.xml"',
        projectRoot: '/home/aidan/vixl',
      }),
    ).toBe('filesystem')
    expect(
      detectSandboxRuntimeDenial(
        "find: '/srv/jellyfin': No such file or directory",
        {
          command: 'find /srv/jellyfin',
          projectRoot: '/project',
        },
      ),
    ).toBe('filesystem')
    expect(
      detectSandboxRuntimeDenial('', {
        command: 'ls /mnt',
        projectRoot: '/project',
      }),
    ).toBe('filesystem')
    expect(
      detectSandboxRuntimeDenial('ls: cannot access /media/disk: ENOENT', {
        command: 'ls /media/disk',
        projectRoot: '/project',
      }),
    ).toBe('filesystem')
  })

  it('does not treat in-project /opt paths or fstab as out-of-workspace', () => {
    expect(
      detectSandboxRuntimeDenial('', {
        command: 'find /opt/vixl -name src',
        projectRoot: '/opt/vixl',
      }),
    ).toBeNull()
    expect(
      detectSandboxRuntimeDenial(FSTAB_ONLY, { command: 'cat /etc/fstab' }),
    ).toBeNull()
  })
})

describe('sandboxRuntimeDenialError', () => {
  it('tells the model this is the OS jail and not to rewrite as Python', () => {
    const filesystem = sandboxRuntimeDenialError('filesystem', 'lstat eperm')
    const devices = sandboxRuntimeDenialError('devices', 'lsblk not available')
    const network = sandboxRuntimeDenialError('network', 'Could not resolve host')

    for (const error of [filesystem, devices, network]) {
      expect(error.message.startsWith('SANDBOX_RUNTIME_BLOCKED:')).toBe(true)
      expect(error.message).toContain('OS jail')
      expect(error.message).toContain('Approve an unsandboxed retry')
      expect(error.message).toContain('Do not rewrite this as a Python script')
    }

    expect(network.message).toContain('Sandboxed shell has no network.')
    expect(network.message).not.toContain('by default')
    expect(isSandboxSpawnError(devices.message)).toBe(true)
  })
})
