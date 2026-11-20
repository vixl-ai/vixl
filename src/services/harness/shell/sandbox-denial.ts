import { detectSandboxRuntimeDenial } from '@/services/harness/shell/sandbox-denial-detectors'

import type {
  DetectSandboxRuntimeDenialOptions,
  SandboxRuntimeDenialKind,
} from '@/services/harness/shell/sandbox-denial-detectors'

// Only wrapper-level spawn failures match isSandboxSpawnError. These prefixes
// come from the Rust sandbox builder rejecting the spawn, not from child
// output. SANDBOX_RUNTIME_BLOCKED is derived from untrusted command
// stdout/stderr, so it never auto-escalates; run_terminal offers it the same
// explicit shell.unsandboxed approval gate as a spawn failure.
const isSandboxSpawnError = (message: string): boolean =>
  message.startsWith('SANDBOX_FAILED:') ||
    message.startsWith('SANDBOX_UNAVAILABLE:')

const parseSandboxRuntimeDenialKind = (
  message: string,
): SandboxRuntimeDenialKind | null => {
  if (!message.includes('SANDBOX_RUNTIME_BLOCKED:')) {
    return null
  }
  if (message.includes('(filesystem EPERM)')) {
    return 'filesystem'
  }
  if (message.includes('(isolated devices)')) {
    return 'devices'
  }
  if (message.includes('(network denied)')) {
    return 'network'
  }
  return null
}

const SANDBOX_DENIAL_DETAIL_MAX = 500

const SANDBOX_JAIL_RETRY_HINT =
  'The OS sandbox (Seatbelt or bubblewrap) blocked this, not a missing package. Do not rerun the same sandboxed command or rewrite it as a script; if no unsandboxed retry approval is offered, or it is denied, report the denial.'

const trimSandboxDenialDetail = (detail: string): string => {
  const trimmed = detail.trim()
  if (trimmed.length <= SANDBOX_DENIAL_DETAIL_MAX) {
    return trimmed
  }
  return `${trimmed.slice(0, SANDBOX_DENIAL_DETAIL_MAX)}...`
}

const isSandboxDeviceRuntimeDenial = (
  kind: SandboxRuntimeDenialKind | null,
): kind is 'devices' => kind === 'devices'

const isSandboxNetworkRuntimeDenial = (
  kind: SandboxRuntimeDenialKind | null,
): kind is 'network' => kind === 'network'

const isSandboxFilesystemRuntimeDenial = (
  kind: SandboxRuntimeDenialKind | null,
): kind is 'filesystem' => kind === 'filesystem'

const sandboxRuntimeDenialError = (
  kind: SandboxRuntimeDenialKind,
  detail: string,
): Error => {
  const trimmed = trimSandboxDenialDetail(detail)
  if (kind === 'filesystem') {
    return new Error(
      `SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (filesystem EPERM). ${SANDBOX_JAIL_RETRY_HINT} Detail: ${trimmed}`,
    )
  }
  if (kind === 'devices') {
    return new Error(
      `SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (isolated devices). Isolated /dev has no block devices. ${SANDBOX_JAIL_RETRY_HINT} Detail: ${trimmed}`,
    )
  }
  return new Error(
    `SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (network denied). Sandboxed shell has no network. ${SANDBOX_JAIL_RETRY_HINT} Detail: ${trimmed}`,
  )
}

export {
  detectSandboxRuntimeDenial,
  isSandboxDeviceRuntimeDenial,
  isSandboxFilesystemRuntimeDenial,
  isSandboxNetworkRuntimeDenial,
  isSandboxSpawnError,
  parseSandboxRuntimeDenialKind,
  sandboxRuntimeDenialError,
}

export type { DetectSandboxRuntimeDenialOptions, SandboxRuntimeDenialKind }
