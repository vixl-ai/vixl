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
      files: [{ path: 'src/main.ts', modifiedMs: 1 }],
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
})
