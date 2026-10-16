import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import type { FileDiff } from '@/types/harness/file-diff'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'
import { decidePermission } from '@/services/harness/permission/policy'
import { fsWriteCapability } from '@/services/harness/permission/policy'
import { permissionPath, sensitiveCheckPaths } from '@/services/harness/tool-roots'

const gateToolPermission = vi.hoisted(() =>
  vi.fn<(args: { capability: string; paths?: string[]; title: string }) => Promise<boolean>>(),
)
const fsStagePreviewWrite = vi.hoisted(() =>
  vi.fn<(args: Record<string, unknown>) => Promise<FileDiff[]>>(async () => []),
)
const fsWriteFile = vi.hoisted(() =>
  vi.fn<(args: Record<string, unknown>) => Promise<unknown>>(async () => undefined),
)

vi.mock('@/services/harness/permission/gate', () => ({
  gateToolPermission,
}))

vi.mock('@/services/harness/capture-baselines-before-mutate', () => ({
  default: vi.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
}))

vi.mock('@/services/harness/shared/notify-fs-mutation', () => ({
  notifyWorkspaceFsMutation: vi.fn<(...args: unknown[]) => void>(),
}))

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsStagePreviewWrite,
    fsWriteFile,
  }),
)

import writeFile from '@/services/harness/write/file'

const api: HarnessWorkspaceMember = {
  slug: 'api',
  name: 'API',
  rootPath: '/tmp/api',
}
const web: HarnessWorkspaceMember = {
  slug: 'web',
  name: 'Web',
  rootPath: '/tmp/web',
}

const baseCtx = (): HarnessToolContext => ({
  projectRoot: '/tmp/api',
  projectSlug: 'stack',
  members: [api, web],
  chatId: 'chat-1',
  mode: 'agent',
  userMessageId: 'user-1',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
})

const execute = async (
  input: Record<string, unknown>,
): Promise<unknown> => {
  const built = writeFile(baseCtx())
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('permission keys are prefixed per member', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    gateToolPermission.mockResolvedValue(true)
    fsStagePreviewWrite.mockResolvedValue([
      { path: 'api/src/.env', operation: 'update', hunks: [] },
    ])
  })

  it('gates write_file on the slug-prefixed capability and path', async () => {
    await execute({ path: 'api/src/.env', content: 'SECRET=1' })

    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'fs.write:api/src/.env',
        paths: ['src/.env'],
        title: 'Write api/src/.env',
      }),
    )
  })

  it('does not let an api path approval key match the same file in web', () => {
    const apiKey = fsWriteCapability(permissionPath([api, web], 'api/src/.env'))
    const webKey = fsWriteCapability(permissionPath([api, web], 'web/src/.env'))
    expect(apiKey).toBe('fs.write:api/src/.env')
    expect(webKey).toBe('fs.write:web/src/.env')
    expect(apiKey).not.toBe(webKey)

    const apiDecision = decidePermission({
      action: 'fs.write',
      capability: webKey,
      paths: ['web/src/.env'],
      settings: {
        version: 1,
        'agent.permissions': [
          { capability: apiKey, verdict: 'allow', scope: 'workspace' },
        ],
      } as VixlSettings,
      permissionLevel: 'ask',
      sessionAllows: new Set([apiKey]),
      sessionDenies: new Set(),
      sandboxEnabled: true,
    })
    expect(apiDecision.verdict).toBe('ask')
  })

  it('passes projectRoots to write IPC when members exist', async () => {
    await execute({ path: 'api/src/.env', content: 'SECRET=1' })

    const roots = [
      { slug: 'api', path: '/tmp/api' },
      { slug: 'web', path: '/tmp/web' },
    ]
    expect(fsStagePreviewWrite).toHaveBeenCalledWith({
      projectRoot: '/tmp/api',
      path: 'api/src/.env',
      content: 'SECRET=1',
      projectRoots: roots,
    })
    expect(fsWriteFile).toHaveBeenCalledWith({
      projectRoot: '/tmp/api',
      path: 'api/src/.env',
      content: 'SECRET=1',
      projectRoots: roots,
    })
  })

  it('omits projectRoots for a single-project write', async () => {
    const built = writeFile({
      ...baseCtx(),
      members: undefined,
      projectRoot: '/tmp/project',
      projectSlug: 'project',
    })
    const runner = built.execute as (
      value: Record<string, unknown>,
      options: { toolCallId: string },
    ) => Promise<unknown>
    await runner({ path: 'src/a.ts', content: 'ok' }, { toolCallId: 'call-1' })

    expect(fsWriteFile).toHaveBeenCalledWith({
      projectRoot: '/tmp/project',
      path: 'src/a.ts',
      content: 'ok',
    })
    expect(fsWriteFile.mock.calls[0]?.[0]).not.toHaveProperty('projectRoots')
  })

  it('still treats a member-relative .env path as sensitive', () => {
    const members = [api, web]
    const decision = decidePermission({
      action: 'fs.write',
      capability: fsWriteCapability(permissionPath(members, 'api/src/.env')),
      paths: sensitiveCheckPaths(members, ['api/src/.env']),
      settings: { version: 1 } as VixlSettings,
      permissionLevel: 'bypass',
      sessionAllows: new Set(['fs.write']),
      sessionDenies: new Set(),
      sandboxEnabled: true,
    })
    expect(sensitiveCheckPaths(members, ['api/src/.env'])).toEqual(['src/.env'])
    expect(decision.verdict).toBe('ask')
    expect(decision.reason).toBe('Sensitive path')
  })

  it('write_file gates a credentials member with a relative path, not the slug', async () => {
    const credentials: HarnessWorkspaceMember = {
      slug: 'credentials',
      name: 'Credentials',
      rootPath: '/tmp/credentials',
    }
    fsStagePreviewWrite.mockResolvedValue([
      { path: 'credentials/src/index.ts', operation: 'update', hunks: [] },
    ])
    const built = writeFile({
      ...baseCtx(),
      projectRoot: '/tmp/credentials',
      members: [credentials],
    })
    const runner = built.execute as (
      value: Record<string, unknown>,
      options: { toolCallId: string },
    ) => Promise<unknown>
    await runner({ path: 'credentials/src/index.ts', content: 'ok' }, { toolCallId: 'call-1' })

    expect(gateToolPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: 'fs.write:credentials/src/index.ts',
        paths: ['src/index.ts'],
        title: 'Write credentials/src/index.ts',
      }),
    )
  })

  it('does not treat a member slug of credentials as a sensitive path', () => {
    const credentials: HarnessWorkspaceMember = {
      slug: 'credentials',
      name: 'Credentials',
      rootPath: '/tmp/credentials',
    }
    const members = [credentials]
    const userPath = 'credentials/src/index.ts'
    expect(permissionPath(members, userPath)).toBe('credentials/src/index.ts')
    expect(sensitiveCheckPaths(members, [userPath])).toEqual(['src/index.ts'])

    const decision = decidePermission({
      action: 'fs.write',
      capability: fsWriteCapability(permissionPath(members, userPath)),
      paths: sensitiveCheckPaths(members, [userPath]),
      settings: { version: 1 } as VixlSettings,
      permissionLevel: 'bypass',
      sessionAllows: new Set(['fs.write']),
      sessionDenies: new Set(),
      sandboxEnabled: true,
    })
    expect(decision.verdict).toBe('allow')
    expect(decision.reason).not.toBe('Sensitive path')
  })
})
