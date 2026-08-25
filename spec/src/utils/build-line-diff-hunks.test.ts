import { describe, expect, it } from 'vitest'
import buildLineDiffHunks from '@/utils/build-line-diff-hunks'
import countDiffLines from '@/utils/count-diff-lines'
import filePathBasename from '@/utils/file-path-basename'
import formatToolRunLabel from '@/utils/format-tool-run-label'
import { parseTerminalToolView, stripSandboxingFooter } from '@/utils/parse-terminal-tool-view'
import resolveFileDiffHunks from '@/utils/resolve-file-diff-hunks'
import type { FileDiff } from '@/types/harness/file-diff'
import type { ToolRun } from '@/types/harness/tool-run'

const toolRun = (partial: Partial<ToolRun> & Pick<ToolRun, 'name'>): ToolRun => ({
  toolCallId: 'call-1',
  status: 'done',
  ...partial,
})

describe('buildLineDiffHunks', () => {
  it('returns empty hunks when texts match', () => {
    expect(buildLineDiffHunks('a\nb\n', 'a\nb\n')).toEqual([])
  })

  it('focuses a middle-of-file change', () => {
    const oldText = 'line1\nline2\nline3\nline4\nline5\nline6\nline7\n'
    const newText = 'line1\nline2\nline3\nchanged\nline5\nline6\nline7\n'
    const hunks = buildLineDiffHunks(oldText, newText)
    expect(hunks).toHaveLength(1)
    const removes = hunks[0]!.lines.filter((line) => line.kind === 'remove')
    const adds = hunks[0]!.lines.filter((line) => line.kind === 'add')
    expect(removes).toEqual([{ kind: 'remove', content: 'line4' }])
    expect(adds).toEqual([{ kind: 'add', content: 'changed' }])
    expect(hunks[0]!.lines.some((line) => line.kind === 'context')).toBe(true)
    expect(hunks[0]!.lines.length).toBeLessThan(14)
  })

  it('treats create as all additions', () => {
    const hunks = buildLineDiffHunks('', 'hello\nworld\n')
    expect(hunks).toHaveLength(1)
    expect(hunks[0]!.lines.every((line) => line.kind === 'add')).toBe(true)
    expect(hunks[0]!.lines).toHaveLength(2)
  })
})

describe('countDiffLines', () => {
  it('counts additions and deletions', () => {
    expect(
      countDiffLines([
        {
          oldStart: 1,
          newStart: 1,
          lines: [
            { kind: 'context', content: 'keep' },
            { kind: 'remove', content: 'old' },
            { kind: 'add', content: 'new' },
            { kind: 'add', content: 'extra' },
          ],
        },
      ]),
    ).toEqual({ additions: 2, deletions: 1 })
  })
})

describe('resolveFileDiffHunks', () => {
  it('recomputes from old and new content', () => {
    const diff: FileDiff = {
      path: 'a.ts',
      operation: 'update',
      oldContent: 'a\nb\nc\n',
      newContent: 'a\nB\nc\n',
      hunks: [
        {
          oldStart: 1,
          newStart: 1,
          lines: [
            { kind: 'remove', content: 'a' },
            { kind: 'remove', content: 'b' },
            { kind: 'remove', content: 'c' },
            { kind: 'add', content: 'a' },
            { kind: 'add', content: 'B' },
            { kind: 'add', content: 'c' },
          ],
        },
      ],
    }
    const hunks = resolveFileDiffHunks(diff)
    const removes = hunks.flatMap((hunk) => hunk.lines.filter((line) => line.kind === 'remove'))
    const adds = hunks.flatMap((hunk) => hunk.lines.filter((line) => line.kind === 'add'))
    expect(removes).toEqual([{ kind: 'remove', content: 'b' }])
    expect(adds).toEqual([{ kind: 'add', content: 'B' }])
  })

  it('keeps rename hunks as stored', () => {
    const diff: FileDiff = {
      path: 'old.ts',
      operation: 'rename',
      newContent: 'new.ts',
      hunks: [
        {
          oldStart: 1,
          newStart: 1,
          lines: [
            { kind: 'remove', content: 'old.ts' },
            { kind: 'add', content: 'new.ts' },
          ],
        },
      ],
    }
    expect(resolveFileDiffHunks(diff)).toEqual(diff.hunks)
  })
})

describe('formatToolRunLabel', () => {
  it('includes path by default', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'edit_file',
          args: { path: 'content/posts/building-durable-chats.md' },
        }),
      ),
    ).toBe('Edited content/posts/building-durable-chats.md')
  })

  it('uses present tense while running', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'edit_file',
          status: 'running',
          args: { path: 'src/a.ts' },
        }),
      ),
    ).toBe('Editing src/a.ts…')
  })

  it('labels create_plan as Writing plan while running', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'create_plan',
          status: 'running',
        }),
      ),
    ).toBe('Writing plan…')
  })

  it('labels spawn_subagent as Starting while running', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'spawn_subagent',
          status: 'running',
          args: { agentName: 'Reading auth' },
        }),
      ),
    ).toBe('Starting Reading auth…')
  })

  it('omits path when omitPathHint is set', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'edit_file',
          args: { path: 'content/posts/building-durable-chats.md' },
        }),
        { omitPathHint: true },
      ),
    ).toBe('Edited')
  })

  it('keeps non-path hints when omitPathHint is set', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'grep',
          args: { pattern: 'TODO' },
        }),
        { omitPathHint: true },
      ),
    ).toBe('Searched TODO')
  })

  it('does not append a failed suffix on error', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'read_file',
          args: { path: 'missing.ts' },
          status: 'error',
        }),
      ),
    ).toBe('Read missing.ts')
  })

  it('labels web_fetch with the URL', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'web_fetch',
          status: 'running',
          args: { url: 'https://example.com/docs' },
        }),
      ),
    ).toBe('Fetching https://example.com/docs…')
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'web_fetch',
          args: { url: 'https://example.com/docs' },
        }),
      ),
    ).toBe('Fetched https://example.com/docs')
  })

  it('labels run_terminal with the short description, not the command', () => {
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'run_terminal',
          args: { command: 'git status --short', description: 'Working tree status' },
        }),
      ),
    ).toBe('Ran command Working tree status')
    expect(
      formatToolRunLabel(
        toolRun({
          name: 'run_terminal',
          args: { command: 'git status --short' },
        }),
      ),
    ).toBe('Ran command')
  })
})

describe('parseTerminalToolView', () => {
  it('returns null for non-terminal tools', () => {
    expect(
      parseTerminalToolView(
        toolRun({
          name: 'read_file',
          args: { path: 'a.ts' },
        }),
      ),
    ).toBeNull()
  })

  it('reads command, exit code, and sandboxed badge fields', () => {
    expect(
      parseTerminalToolView(
        toolRun({
          name: 'run_terminal',
          args: { command: 'git status --short' },
          result: {
            command: 'git status --short',
            stdout: ' M src/a.ts',
            stderr: '',
            exitCode: 0,
            sandboxed: true,
            shellId: 'shell-1',
          },
        }),
      ),
    ).toEqual({
      command: 'git status --short',
      label: '',
      shellId: 'shell-1',
      phases: [
        {
          sandboxed: true,
          exitCode: 0,
          output: ' M src/a.ts',
          title: 'Sandboxed',
          badge: 'sandboxed',
        },
      ],
    })
  })

  it('shows the final unsandboxed phase when priorPhase is absent', () => {
    expect(
      parseTerminalToolView(
        toolRun({
          name: 'run_terminal',
          args: { command: 'ls /dev/disk' },
          result: {
            command: 'ls /dev/disk',
            stdout: 'disk0',
            exitCode: 0,
            sandboxed: false,
            shellId: 'shell-2',
          },
        }),
      ),
    ).toEqual({
      command: 'ls /dev/disk',
      label: '',
      shellId: 'shell-2',
      phases: [
        {
          sandboxed: false,
          exitCode: 0,
          output: 'disk0',
          title: 'Unsandboxed',
          badge: 'unsandboxed',
        },
      ],
    })
  })

  it('keeps sandbox then unsandboxed phases from priorPhase', () => {
    expect(
      parseTerminalToolView(
        toolRun({
          name: 'run_terminal',
          args: { command: 'ls /dev/disk' },
          result: {
            command: 'ls /dev/disk',
            stdout: 'disk0',
            exitCode: 0,
            sandboxed: false,
            shellId: 'shell-2',
            priorPhase: {
              sandboxed: true,
              stdout: '',
              error: 'Sandbox blocked: isolated devices',
              exitCode: 1,
            },
          },
        }),
      ),
    ).toEqual({
      command: 'ls /dev/disk',
      label: '',
      shellId: 'shell-2',
      phases: [
        {
          sandboxed: true,
          exitCode: 1,
          output: 'Sandbox blocked: isolated devices',
          title: 'Sandboxed',
          badge: 'sandboxed',
        },
        {
          sandboxed: false,
          exitCode: 0,
          output: 'disk0',
          title: 'Unsandboxed',
          badge: 'unsandboxed',
        },
      ],
    })
  })

  it('renders terminal_output stdout instead of a JSON blob', () => {
    expect(
      parseTerminalToolView(
        toolRun({
          name: 'terminal_output',
          args: { shell_id: 'shell-3' },
          result: {
            shellId: 'shell-3',
            status: 'running',
            stdout: 'listening on 5173',
            stderr: '',
            exitCode: null,
          },
        }),
      ),
    ).toEqual({
      command: '',
      label: '',
      shellId: 'shell-3',
      phases: [
        {
          output: 'listening on 5173',
          title: 'Terminal',
        },
      ],
    })
  })

  it('prefers the short description as the terminal label', () => {
    expect(
      parseTerminalToolView(
        toolRun({
          name: 'run_terminal',
          status: 'running',
          args: {
            command: 'find /var/lib/jellyfin -name jellyfin.db',
            description: 'Find Jellyfin database',
          },
        }),
      ),
    ).toEqual({
      command: 'find /var/lib/jellyfin -name jellyfin.db',
      label: 'Find Jellyfin database',
      phases: [{ output: '', title: 'Terminal' }],
    })
  })

  it('strips SANDBOXING footers from error text', () => {
    expect(
      stripSandboxingFooter(
        'Sandbox blocked: isolated devices\n\nSANDBOXING: This command ran in a sandbox',
      ),
    ).toBe('Sandbox blocked: isolated devices')
  })
})

describe('filePathBasename', () => {
  it('returns the final path segment', () => {
    expect(filePathBasename('content/posts/building-durable-chats.md')).toBe(
      'building-durable-chats.md',
    )
  })
})
