const normalizeWorkspaceRoot = (path: string): string => {
  const slashed = path.trim().replace(/\\/g, '/')
  if (slashed === '/') {
    return '/'
  }
  return slashed.replace(/\/+$/, '')
}

/** String stand-in for the Rust home check, driven by a mocked home path. */
export const mockedHomeWorkspaceRoot = async (
  rootPath: unknown,
  readHome: () => Promise<string>,
): Promise<boolean> => {
  const root = typeof rootPath === 'string' ? rootPath.trim() : ''
  if (!root) {
    return false
  }

  try {
    const home = await readHome()
    if (!home.trim()) {
      return false
    }
    return normalizeWorkspaceRoot(root) === normalizeWorkspaceRoot(home)
  } catch {
    return false
  }
}

export const createHomeWorkspaceHelpersMock = (readHome: () => Promise<string>) => ({
  isTauri: () => true,
  call: async (command: string, args?: Record<string, unknown>) => {
    if (command !== 'is_home_workspace_root') {
      throw new Error(`unexpected command ${command}`)
    }
    return mockedHomeWorkspaceRoot(args?.rootPath, readHome)
  },
})
