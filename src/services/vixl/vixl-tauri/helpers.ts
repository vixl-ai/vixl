import { invoke } from '@tauri-apps/api/core'

export const isTauri = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const toError = (reason: unknown): Error => {
  if (reason instanceof Error) {
    return reason
  }
  if (typeof reason === 'string' && reason.length > 0) {
    return new Error(reason)
  }
  return new Error('Unknown error')
}

export const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  if (!isTauri()) {
    throw new Error('Vixl desktop APIs are only available in the Tauri app')
  }
  try {
    return await invoke<T>(command, args)
  } catch (reason) {
    throw toError(reason)
  }
}
