import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockTauriCore } from '../../test-utils/mocks/tauri-core'

const invoke = vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>()

vi.mock('@tauri-apps/api/core', () => mockTauriCore({ invoke }))

const setTauriWindow = (): void => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: {},
    configurable: true,
  })
}

describe('vixl-tauri IPC adapters', () => {
  beforeEach(() => {
    invoke.mockReset()
    setTauriWindow()
  })

  it('wraps workspace_glob request and returns result', async () => {
    invoke.mockResolvedValueOnce({
      files: [{ path: 'src/main.ts' }],
      truncated: false,
    })

    const { workspaceGlob } = await import('@/services/vixl/vixl-tauri')
    const result = await workspaceGlob('/project', '**/*.ts')

    expect(invoke).toHaveBeenCalledWith('workspace_glob', {
      request: { projectRoot: '/project', pattern: '**/*.ts', limit: undefined },
    })
    expect(result.files).toHaveLength(1)
  })

  it('wraps workspace_grep request and returns result', async () => {
    invoke.mockResolvedValueOnce({
      matches: [{ path: 'src/main.ts', lineNumber: 1, line: 'import' }],
      truncated: false,
    })

    const { workspaceGrep } = await import('@/services/vixl/vixl-tauri')
    const result = await workspaceGrep({
      projectRoot: '/project',
      pattern: 'import',
      glob: '*.ts',
    })

    expect(invoke).toHaveBeenCalledWith('workspace_grep', {
      request: {
        projectRoot: '/project',
        pattern: 'import',
        glob: '*.ts',
      },
    })
    expect(result.matches).toHaveLength(1)
  })

  it('forwards optional workspace_grep search flags', async () => {
    invoke.mockResolvedValueOnce({
      matches: [
        {
          path: 'src/main.ts',
          lineNumber: 1,
          line: 'foo foo',
          startColumn: 1,
          endColumn: 4,
        },
      ],
      truncated: false,
    })

    const { workspaceGrep } = await import('@/services/vixl/vixl-tauri')
    const result = await workspaceGrep({
      projectRoot: '/project',
      pattern: 'foo',
      regex: false,
      wholeWord: true,
      excludeGlob: 'node_modules/**',
      caseInsensitive: true,
      maxResults: 50,
    })

    expect(invoke).toHaveBeenCalledWith('workspace_grep', {
      request: {
        projectRoot: '/project',
        pattern: 'foo',
        regex: false,
        wholeWord: true,
        excludeGlob: 'node_modules/**',
        caseInsensitive: true,
        maxResults: 50,
      },
    })
    expect(result.matches[0]?.startColumn).toBe(1)
    expect(result.matches[0]?.endColumn).toBe(4)
  })

  it('passes tagged write request to fs_stage_preview', async () => {
    invoke.mockResolvedValueOnce([])

    const { fsStagePreviewWrite } = await import('@/services/vixl/vixl-tauri')
    await fsStagePreviewWrite({
      projectRoot: '/project',
      path: 'src/main.ts',
      content: 'const app = createApp(App)',
    })

    expect(invoke).toHaveBeenCalledWith('fs_stage_preview', {
      projectRoot: '/project',
      request: {
        kind: 'write',
        path: 'src/main.ts',
        content: 'const app = createApp(App)',
      },
    })
  })

  it('passes tagged edit request to fs_stage_preview', async () => {
    invoke.mockResolvedValueOnce([])

    const { fsStagePreviewEdit } = await import('@/services/vixl/vixl-tauri')
    await fsStagePreviewEdit({
      projectRoot: '/project',
      path: 'src/main.ts',
      replacements: [{ oldString: 'old', newString: 'new' }],
    })

    expect(invoke).toHaveBeenCalledWith('fs_stage_preview', {
      projectRoot: '/project',
      request: {
        kind: 'edit',
        path: 'src/main.ts',
        replacements: [{ oldString: 'old', newString: 'new' }],
      },
    })
  })

  it('passes replacements array to fs_edit_file', async () => {
    invoke.mockResolvedValueOnce({ path: 'src/main.ts', operation: 'update', hunks: [] })

    const { fsEditFile } = await import('@/services/vixl/vixl-tauri')
    await fsEditFile({
      projectRoot: '/project',
      path: 'src/main.ts',
      replacements: [{ oldString: 'old', newString: 'new' }],
    })

    expect(invoke).toHaveBeenCalledWith('fs_edit_file', {
      projectRoot: '/project',
      path: 'src/main.ts',
      replacements: [{ oldString: 'old', newString: 'new' }],
    })
  })

  it('wraps serialized Tauri invoke rejections as Errors with a useful message', async () => {
    invoke.mockRejectedValueOnce({ message: 'stdout unavailable' })

    const { workspaceGlob } = await import('@/services/vixl/vixl-tauri')

    await expect(workspaceGlob('/project', '**/*.ts')).rejects.toMatchObject({
      name: 'Error',
      message: 'stdout unavailable',
    })
  })

  it('wraps object invoke rejections that use an error field', async () => {
    invoke.mockRejectedValueOnce({ error: 'permission denied' })

    const { workspaceGlob } = await import('@/services/vixl/vixl-tauri')

    await expect(workspaceGlob('/project', '**/*.ts')).rejects.toMatchObject({
      name: 'Error',
      message: 'permission denied',
    })
  })

  it('wraps JSON-stringifiable invoke rejections without message fields', async () => {
    invoke.mockRejectedValueOnce({ code: 'Io', details: 'broken pipe' })

    const { workspaceGlob } = await import('@/services/vixl/vixl-tauri')

    await expect(workspaceGlob('/project', '**/*.ts')).rejects.toMatchObject({
      name: 'Error',
      message: '{"code":"Io","details":"broken pipe"}',
    })
  })

  it('preserves Error invoke rejections', async () => {
    const original = new Error('boom')
    invoke.mockRejectedValueOnce(original)

    const { workspaceGlob } = await import('@/services/vixl/vixl-tauri')

    await expect(workspaceGlob('/project', '**/*.ts')).rejects.toBe(original)
  })
})

describe('vixl-tauri worktree IPC adapters', () => {
  beforeEach(() => {
    invoke.mockReset()
    setTauriWindow()
  })

  it('calls git_worktree_list with rootPath', async () => {
    invoke.mockResolvedValueOnce([
      { path: '/repo', branch: 'main', bare: false, detached: false },
    ])

    const { gitWorktreeList } = await import('@/services/vixl/vixl-tauri')
    const result = await gitWorktreeList('/repo')

    expect(invoke).toHaveBeenCalledWith('git_worktree_list', { rootPath: '/repo' })
    expect(result).toEqual([
      { path: '/repo', branch: 'main', bare: false, detached: false },
    ])
  })

  it('calls git_worktree_add with rootPath, name, and optional baseRef', async () => {
    invoke.mockResolvedValueOnce({
      path: '/vixl/worktrees/demo/feature',
      branch: 'feature',
      name: 'feature',
    })

    const { gitWorktreeAdd } = await import('@/services/vixl/vixl-tauri')
    const result = await gitWorktreeAdd('/repo', 'feature', 'main')

    expect(invoke).toHaveBeenCalledWith('git_worktree_add', {
      rootPath: '/repo',
      name: 'feature',
      baseRef: 'main',
    })
    expect(result).toEqual({
      path: '/vixl/worktrees/demo/feature',
      branch: 'feature',
      name: 'feature',
    })
  })

  it('omits baseRef when git_worktree_add is called without it', async () => {
    invoke.mockResolvedValueOnce({
      path: '/vixl/worktrees/demo/review',
      branch: 'review',
      name: 'review',
    })

    const { gitWorktreeAdd } = await import('@/services/vixl/vixl-tauri')
    await gitWorktreeAdd('/repo', 'review')

    expect(invoke).toHaveBeenCalledWith('git_worktree_add', {
      rootPath: '/repo',
      name: 'review',
    })
  })

  it('calls git_worktree_remove with rootPath, worktreePath, and force', async () => {
    invoke.mockResolvedValueOnce(undefined)

    const { gitWorktreeRemove } = await import('@/services/vixl/vixl-tauri')
    await gitWorktreeRemove('/repo', '/vixl/worktrees/demo/feature', true)

    expect(invoke).toHaveBeenCalledWith('git_worktree_remove', {
      rootPath: '/repo',
      worktreePath: '/vixl/worktrees/demo/feature',
      force: true,
    })
  })

  it('calls worktree_detect_parent with path', async () => {
    invoke.mockResolvedValueOnce({ parentProjectId: 'proj-a', branch: 'feature' })

    const { worktreeDetectParent } = await import('@/services/vixl/vixl-tauri')
    const result = await worktreeDetectParent('/vixl/worktrees/demo/feature')

    expect(invoke).toHaveBeenCalledWith('worktree_detect_parent', {
      path: '/vixl/worktrees/demo/feature',
    })
    expect(result).toEqual({ parentProjectId: 'proj-a', branch: 'feature' })
  })
})
