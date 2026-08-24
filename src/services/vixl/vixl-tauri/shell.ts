import type { ShellExitResult } from '@/types/harness/shell-exit'
import { call } from './helpers'

export const shellSpawnPty = (args: {
  projectRoot: string
  cols: number
  rows: number
  cwd?: string
}): Promise<{ sessionId: string }> => call('shell_spawn_pty', args)

export const shellWritePty = (sessionId: string, data: string): Promise<void> =>
  call('shell_write_pty', { sessionId, data })

export const shellResizePty = (
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> => call('shell_resize_pty', { sessionId, cols, rows })

export const shellKillPty = (sessionId: string): Promise<void> =>
  call('shell_kill_pty', { sessionId })

export const shellSpawnTracked = (args: {
  shellId: string
  projectRoot: string
  command: string
  sandboxed?: boolean
  allowNetwork?: boolean
}): Promise<void> => call('shell_spawn_tracked', args)

export const shellKillTracked = (shellId: string): Promise<ShellExitResult> =>
  call('shell_kill_tracked', { shellId })
