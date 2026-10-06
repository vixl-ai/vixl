import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockTauriCore } from '../../test-utils/mocks/tauri-core'

const invoke = vi.hoisted(() =>
  vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>(),
)

vi.mock('@tauri-apps/api/core', () => mockTauriCore({ invoke }))

import { isHomeWorkspaceRoot } from '@/services/config/is-home-workspace-root'

const setTauriWindow = (): void => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {},
    configurable: true,
  })
}

beforeEach(() => {
  invoke.mockReset()
  setTauriWindow()
})

describe('isHomeWorkspaceRoot', () => {
  it('asks the canonical home command and returns its answer', async () => {
    invoke.mockResolvedValueOnce(true)

    await expect(isHomeWorkspaceRoot('  /Users/test-home/  ')).resolves.toBe(true)
    expect(invoke).toHaveBeenCalledWith('is_home_workspace_root', {
      rootPath: '/Users/test-home/',
    })
  })

  it('returns false when the command says the root is not home', async () => {
    invoke.mockResolvedValueOnce(false)

    await expect(isHomeWorkspaceRoot('/tmp/proj')).resolves.toBe(false)
  })

  it('returns false when the command fails', async () => {
    invoke.mockRejectedValueOnce(new Error('unavailable'))

    await expect(isHomeWorkspaceRoot('/Users/test-home')).resolves.toBe(false)
  })

  it('returns false for an empty root without calling the command', async () => {
    await expect(isHomeWorkspaceRoot('')).resolves.toBe(false)
    await expect(isHomeWorkspaceRoot('   ')).resolves.toBe(false)
    await expect(isHomeWorkspaceRoot(null)).resolves.toBe(false)
    await expect(isHomeWorkspaceRoot(undefined)).resolves.toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })

  it('returns false outside the Tauri app', async () => {
    Reflect.deleteProperty(window, '__TAURI_INTERNALS__')

    await expect(isHomeWorkspaceRoot('/Users/test-home')).resolves.toBe(false)
    expect(invoke).not.toHaveBeenCalled()
  })
})
