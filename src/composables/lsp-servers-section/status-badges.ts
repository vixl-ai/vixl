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
import type { LspCatalogEntry } from '@/services/vixl/vixl-tauri'

export type LspStatusBadge = {
  key: string
  label: string
  icon: Component
  className: string
}

export const buildStatusBadges = (
  entry: LspCatalogEntry,
  workspaceTrusted: boolean,
): LspStatusBadge[] => {
  const badges: LspStatusBadge[] = []

  if (entry.disabled) {
    badges.push({
      key: 'disabled',
      label: 'Disabled',
      icon: Ban,
      className: 'text-muted-foreground',
    })
  }

  if (entry.requiresTrust && !workspaceTrusted) {
    badges.push({
      key: 'trust',
      label: 'Requires workspace trust',
      icon: ShieldAlert,
      className: 'text-amber-600 dark:text-amber-500',
    })
  }

  if (entry.running) {
    badges.push({
      key: 'running',
      label: 'Running',
      icon: Activity,
      className: 'text-emerald-600 dark:text-emerald-500',
    })
  }

  if (entry.source === 'managed') {
    badges.push({
      key: 'managed',
      label: 'Managed install',
      icon: Package,
      className: 'text-muted-foreground',
    })
  } else if (entry.source === 'path') {
    badges.push({
      key: 'path',
      label: 'Available on PATH',
      icon: HardDrive,
      className: 'text-muted-foreground',
    })
  } else if (entry.source === 'custom') {
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

  if (entry.error) {
    badges.push({
      key: 'error',
      label: entry.error,
      icon: AlertCircle,
      className: 'text-destructive',
    })
  } else if (
    entry.installState
    && entry.installState !== 'ready'
    && entry.installState !== 'missing'
    && entry.installState !== 'toolchain'
    && entry.installState !== 'stopped'
  ) {
    badges.push({
      key: 'state',
      label: entry.installState,
      icon: Loader2,
      className: 'text-muted-foreground',
    })
  }

  return badges
}
