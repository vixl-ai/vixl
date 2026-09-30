import type { ShellExitResult } from '@/types/harness/shell-exit'

export default (exit: Pick<ShellExitResult, 'exitCode' | 'signal'>): string => {
  if (exit.signal != null) {
    return `stopped by signal ${exit.signal}`
  }
  return String(exit.exitCode)
}
