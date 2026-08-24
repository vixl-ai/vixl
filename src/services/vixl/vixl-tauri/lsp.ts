import { call } from './helpers'
import type { LspCatalogEntry, LspServerStatus } from './types'

export const lspStatus = (): Promise<LspServerStatus[]> => call('lsp_status')

export const lspCatalog = (): Promise<LspCatalogEntry[]> => call('lsp_catalog')

export const lspRequest = (
  serverId: string,
  method: string,
  params: Record<string, unknown>,
): Promise<unknown> => call('lsp_request', { serverId, method, params })

export const lspEnsureServer = (
  extension: string,
  projectRoot?: string | null,
): Promise<LspServerStatus> =>
  call('lsp_ensure_server', { extension, projectRoot: projectRoot ?? null })

export const lspStopServer = (serverId: string): Promise<void> =>
  call('lsp_stop_server', { serverId })

export const lspPrefetchDefaults = (): Promise<void> => call('lsp_prefetch_defaults')

export const lspInstallServer = (serverId: string): Promise<void> =>
  call('lsp_install_server', { serverId })

export const lspUninstallServer = (serverId: string): Promise<void> =>
  call('lsp_uninstall_server', { serverId })

export const lspSetServerDisabled = (
  serverId: string,
  disabled: boolean,
): Promise<void> =>
  call('lsp_set_server_disabled', {
    serverId,
    disabled,
  })
