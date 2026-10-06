import { call } from '@/services/vixl/vixl-tauri/helpers'

export const HOME_PROJECT_SCOPE_ERROR =
  'Refusing project-scope changes for the home directory'

// Project scope for the home directory resolves to ~/.vixl, the personal root.
// Rust compares dunce-canonical paths so a fleet root still matches home.
export const isHomeWorkspaceRoot = async (
  rootPath: string | null | undefined,
): Promise<boolean> => {
  const root = rootPath?.trim()
  if (!root) {
    return false
  }

  try {
    return (await call<boolean>('is_home_workspace_root', { rootPath: root })) === true
  } catch {
    return false
  }
}
