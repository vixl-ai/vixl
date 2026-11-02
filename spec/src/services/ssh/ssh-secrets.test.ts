import { beforeEach, describe, expect, it, vi } from 'vitest'

const sshSavePassword = vi.hoisted(() =>
  vi.fn<(user: string, hostname: string, port: number, value: string) => Promise<void>>(
    async () => undefined,
  ),
)
const sshDeletePassword = vi.hoisted(() =>
  vi.fn<(user: string, hostname: string, port: number) => Promise<void>>(async () => undefined),
)
const sshSavePassphrase = vi.hoisted(() =>
  vi.fn<(keyPath: string, value: string) => Promise<void>>(async () => undefined),
)
const sshDeletePassphrase = vi.hoisted(() =>
  vi.fn<(keyPath: string) => Promise<void>>(async () => undefined),
)
const sshListSavedIdentities = vi.hoisted(() =>
  vi.fn<() => Promise<Array<{ kind: string; identity: string }>>>(async () => []),
)

vi.mock('@/services/vixl/vixl-tauri/ssh', () => ({
  sshSavePassword,
  sshDeletePassword,
  sshSavePassphrase,
  sshDeletePassphrase,
  sshListSavedIdentities,
}))

describe('ssh-secrets settings helpers', () => {
  beforeEach(() => {
    sshSavePassword.mockClear()
    sshDeletePassword.mockClear()
  })

  it('replaceSavedPassword and removeSavedPassword call dedicated ssh commands', async () => {
    const { replaceSavedPassword, removeSavedPassword } = await import('@/services/ssh/ssh-secrets')

    await expect(
      replaceSavedPassword('aidanhibbard', 'eva.local', 22, 'typed-value'),
    ).resolves.toBeUndefined()
    await expect(removeSavedPassword('aidanhibbard', 'eva.local', 22)).resolves.toBeUndefined()

    expect(sshSavePassword).toHaveBeenCalledWith('aidanhibbard', 'eva.local', 22, 'typed-value')
    expect(sshDeletePassword).toHaveBeenCalledWith('aidanhibbard', 'eva.local', 22)
  })
})
