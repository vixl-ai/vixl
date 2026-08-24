import { homeDir } from '@tauri-apps/api/path'
import { lspConfigSchema } from '@/schemas/lsp-config'
import { call, isTauri } from './helpers'
import type { ConfigScope, ProjectFileEntry, VixlFilesKind } from './types'

export const getUserVixlDir = (): Promise<string> => call('get_user_vixl_dir')

export const readJsonFile = (path: string): Promise<unknown> =>
  call('read_json_file', { path })

export const writeJsonFile = (path: string, value: unknown): Promise<void> =>
  call('write_json_file', { path, value })

export const hasProjectVixl = (rootPath: string): Promise<boolean> =>
  call('has_project_vixl', { rootPath })

export const readSettings = (
  scope: ConfigScope,
  rootPath?: string | null,
): Promise<Record<string, unknown>> =>
  call('read_settings', { scope, rootPath: rootPath ?? null })

export const writeSettings = (
  scope: ConfigScope,
  settings: Record<string, unknown>,
  rootPath?: string | null,
): Promise<void> =>
  call('write_settings', { scope, settings, rootPath: rootPath ?? null })

export const readMcpConfig = (
  scope: ConfigScope,
  rootPath?: string | null,
): Promise<Record<string, unknown>> =>
  call('read_mcp_config', { scope, rootPath: rootPath ?? null })

export const writeMcpConfig = (
  scope: ConfigScope,
  config: Record<string, unknown>,
  rootPath?: string | null,
): Promise<void> =>
  call('write_mcp_config', { scope, config, rootPath: rootPath ?? null })

export const readLspConfig = async (): Promise<Record<string, unknown> | boolean> => {
  const raw = await call<unknown>('read_lsp_config')
  const parsed = lspConfigSchema.safeParse(raw)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid lsp.json')
  }
  return parsed.data as Record<string, unknown> | boolean
}

export const writeLspConfig = async (
  config: Record<string, unknown> | boolean,
): Promise<void> => {
  const parsed = lspConfigSchema.safeParse(config)
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'Invalid lsp.json')
  }
  await call('write_lsp_config', { config: parsed.data })
}

export const watchVixlPaths = (projectRoot?: string | null): Promise<void> =>
  call('watch_vixl_paths', { projectRoot: projectRoot ?? null })

export const getSecret = (key: string): Promise<string | null> =>
  call('get_secret', { key })

export const setSecret = (key: string, value: string): Promise<void> =>
  call('set_secret', { key, value })

export const deleteSecret = (key: string): Promise<void> => call('delete_secret', { key })

export const configExists = (
  scope: ConfigScope,
  rootPath?: string | null,
): Promise<boolean> => call('config_exists', { scope, rootPath: rootPath ?? null })

export const registryListProjects = (): Promise<
  Array<{
    id: string
    name: string
    slug: string
    root_path: string
    last_opened: string
  }>
> => call('registry_list_projects')

export const registryAddProject = (
  name: string,
  rootPath: string,
): Promise<{
  id: string
  name: string
  slug: string
  root_path: string
  last_opened: string
}> => call('registry_add_project', { name, rootPath })

export const openProjectAtPath = (
  rootPath: string,
): Promise<{
  id: string
  name: string
  slug: string
  root_path: string
  last_opened: string
}> => call('open_project_at_path', { rootPath })

export const registrySetActiveProject = (projectId: string | null): Promise<void> =>
  call('registry_set_active_project', { projectId })

export const registryUpdateProjectRoot = (
  projectId: string,
  rootPath: string,
): Promise<{
  id: string
  name: string
  slug: string
  root_path: string
  last_opened: string
}> => call('registry_update_project_root', { projectId, rootPath })

export const registryRemoveProject = (projectId: string): Promise<void> =>
  call('registry_remove_project', { projectId })

export const getDefaultWorkspaceRoot = (): Promise<string> =>
  call('get_default_workspace_root')

export const getUserHomeDir = (): Promise<string> => {
  if (!isTauri()) {
    return Promise.reject(
      new Error('Vixl desktop APIs are only available in the Tauri app'),
    )
  }
  return homeDir()
}

export const getActiveProjectId = (): Promise<string | null> => call('get_active_project')

export const getVixlDir = (
  scope: ConfigScope,
  rootPath?: string | null,
): Promise<string> => call('get_vixl_dir', { scope, rootPath: rootPath ?? null })

export const listVixlFiles = (
  scope: ConfigScope,
  kind: VixlFilesKind,
  rootPath?: string | null,
): Promise<ProjectFileEntry[]> =>
  call('list_vixl_files', { scope, kind, rootPath: rootPath ?? null })

export const listProjectFiles = (
  rootPath: string,
  kind: 'agents' | 'rules' | 'skills',
): Promise<ProjectFileEntry[]> => call('list_project_files', { rootPath, kind })
