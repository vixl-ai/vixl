import type { Component } from 'vue'
import {
  Activity,
  AlertCircle,
  Ban,
  HardDrive,
  Loader2,
  Package,
  PackageX,
  ShieldAlert,
  Wrench,
} from '@lucide/vue'
import {
  formatActivityLabel,
  isTransientPhase,
  phaseLabel,
} from '@/composables/lsp-status/helpers'
import type { LspCatalogEntry } from '@/services/vixl/vixl-tauri'

export type LspStatusBadge = {
  key: string
  label: string
  tooltip?: string
  icon: Component
  className: string
}

export const buildStatusBadges = (
  entry: LspCatalogEntry,
  workspaceTrusted: boolean,
): LspStatusBadge[] => {
  const { state } = entry
  const badges: LspStatusBadge[] = []

  if (entry.disabled) {
    badges.push({
      key: 'disabled',
      label: 'Disabled',
      icon: Ban,
      className: 'text-muted-foreground',
    })
  }

  if (state.phase === 'needs_trust' || (entry.requiresTrust && !workspaceTrusted)) {
    badges.push({
      key: 'trust',
      label: 'Requires workspace trust',
      icon: ShieldAlert,
      className: 'text-amber-600 dark:text-amber-500',
    })
  }

  if (state.phase === 'running') {
    badges.push({
      key: 'running',
      label: 'Running',
      icon: Activity,
      className: 'text-emerald-600 dark:text-emerald-500',
    })
  }

  if (state.source === 'managed') {
    badges.push({
      key: 'managed',
      label: 'Managed install',
      icon: Package,
      className: 'text-muted-foreground',
    })
  } else if (state.source === 'path') {
    badges.push({
      key: 'path',
      label: 'Available on PATH',
      icon: HardDrive,
      className: 'text-muted-foreground',
    })
  } else if (state.source === 'custom') {
    badges.push({
      key: 'custom',
      label: 'Custom configuration',
      icon: HardDrive,
      className: 'text-muted-foreground',
    })
  } else if (entry.installable && !entry.installed) {
    badges.push({
      key: 'missing',
      label: 'Not installed',
      icon: PackageX,
      className: 'text-muted-foreground',
    })
  } else if (entry.installKind === 'toolchain') {
    badges.push({
      key: 'toolchain',
      label: 'Needs toolchain on PATH',
      icon: Wrench,
      className: 'text-muted-foreground',
    })
  }

  if (state.phase === 'error' || state.phase === 'crashed') {
    badges.push({
      key: 'error',
      label: state.error ?? phaseLabel[state.phase],
      icon: AlertCircle,
      className: 'text-destructive',
    })
  }

  if (isTransientPhase(state.phase)) {
    badges.push({
      key: 'state',
      label: phaseLabel[state.phase],
      tooltip: state.message ?? undefined,
      icon: Loader2,
      className: 'text-muted-foreground',
    })
  }

  if (state.activity) {
    badges.push({
      key: 'activity',
      label: formatActivityLabel(state.activity),
      icon: Loader2,
      className: 'text-muted-foreground',
    })
  }

  return badges
}
