import { detectSandboxRuntimeDenial } from '@/services/harness/shell/sandbox-denial-detectors'

import type {
  DetectSandboxRuntimeDenialOptions,
  SandboxRuntimeDenialKind,
} from '@/services/harness/shell/sandbox-denial-detectors'

const isSandboxSpawnError = (message: string): boolean =>
  message.startsWith('SANDBOX_FAILED:') ||
    message.startsWith('SANDBOX_UNAVAILABLE:') ||
    message.startsWith('SANDBOX_RUNTIME_BLOCKED:')

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
  'This is the OS jail (Seatbelt or bubblewrap), not a missing package. Approve an unsandboxed retry. Do not rewrite this as a Python script.'

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
    `SANDBOX_RUNTIME_BLOCKED: Sandbox blocked this command (network denied). Sandboxed shell has no network by default. ${SANDBOX_JAIL_RETRY_HINT} Detail: ${trimmed}`,
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
