import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { PendingApprovalView } from '@/services/harness/permission/gate'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { ProjectFileEntry } from '@/services/vixl/vixl-tauri'

const getUserHomeDir = vi.hoisted(() =>
  vi.fn<() => Promise<string>>(async () => '/Users/test-home'),
)

vi.mock('@/services/vixl/vixl-tauri/home-dir', () => ({
  getUserHomeDir,
}))

vi.mock('@/services/vixl/vixl-tauri/helpers', async () => {
  const { createHomeWorkspaceHelpersMock } = await import(
    '../../../test-utils/mocks/home-workspace-command'
  )
  return createHomeWorkspaceHelpersMock(getUserHomeDir)
})

vi.mock('@/services/vixl/vixl-tauri', () => mockVixlTauri())

import loadSkillTool from '@/services/harness/skill/load'
import { fsReadFile, getVixlDir, listVixlFiles } from '@/services/vixl/vixl-tauri'

const apiRoot = '/tmp/api'
const webRoot = '/tmp/web'
const members = [
  { slug: 'api', name: 'API', rootPath: apiRoot },
  { slug: 'web', name: 'Web', rootPath: webRoot },
]

const skillFile = (body: string) => ({
  path: 'SKILL.md',
  content: `---\ndescription: Loaded\n---\n\n${body}\n`,
  totalLines: 4,
  offset: 0,
  limit: 0,
})

const stubSkillDisks = (options: {
  personal?: ProjectFileEntry[]
  byProject?: Record<string, ProjectFileEntry[]>
}): void => {
  vi.mocked(listVixlFiles).mockImplementation(async (scope, kind, rootPath) => {
    if (kind !== 'skills') {
      return []
    }
    if (scope === 'personal') {
      return options.personal ?? []
    }
    if (scope === 'project' && rootPath) {
      return options.byProject?.[rootPath] ?? []
    }
    return []
  })
}

const ctx: HarnessToolContext = {
  projectRoot: apiRoot,
  projectSlug: 'stack',
  members,
  chatId: 'chat-1',
  mode: 'agent',
  userMessageId: 'user-1',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set<string>(),
  sessionDenies: new Set<string>(),
  sandboxEnabled: false,
  supportsVision: false,
  onPendingApproval: vi.fn<(entry: PendingApprovalView) => void>(),
}

const runTool = async (
  name: string,
  toolCtx: HarnessToolContext = ctx,
): Promise<unknown> => {
  const built = loadSkillTool(toolCtx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner({ name }, { toolCallId: 'tc-load-skill' })
}

describe('load_skill member resolution', () => {
  beforeEach(() => {
    vi.mocked(listVixlFiles).mockReset()
    vi.mocked(fsReadFile).mockReset()
    vi.mocked(getVixlDir).mockReset()
    getUserHomeDir.mockReset()
    getUserHomeDir.mockResolvedValue('/Users/test-home')
    vi.mocked(getVixlDir).mockResolvedValue('/tmp/personal-vixl')
    stubSkillDisks({
      personal: [],
      byProject: {
        [apiRoot]: [
          {
            name: 'deploy',
            path: `${apiRoot}/.vixl/skills/deploy`,
            description: 'API deploy',
          },
        ],
        [webRoot]: [
          {
            name: 'deploy',
            path: `${webRoot}/.vixl/skills/deploy`,
            description: 'Web deploy',
          },
          {
            name: 'lint',
            path: `${webRoot}/.vixl/skills/lint`,
            description: 'Web lint',
          },
        ],
      },
    })
    vi.mocked(fsReadFile).mockImplementation(async ({ projectRoot, path }) => {
      if (projectRoot === apiRoot && path.includes('deploy')) {
        return skillFile('API deploy body')
      }
      if (projectRoot === webRoot && path.includes('deploy')) {
        return skillFile('Web deploy body')
      }
      if (projectRoot === webRoot && path.includes('lint')) {
        return skillFile('Web lint body')
      }
      return skillFile('other')
    })
  })

  it('loads a qualified skill from that member root', async () => {
    const result = await runTool('api:deploy')
    expect(result).toMatchObject({
      name: 'deploy',
      content: 'API deploy body',
    })
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot: apiRoot,
      path: '.vixl/skills/deploy/SKILL.md',
    })
  })

  it('loads a bare unique skill from the member that defines it', async () => {
    const result = await runTool('lint')
    expect(result).toMatchObject({
      name: 'lint',
      content: 'Web lint body',
    })
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot: webRoot,
      path: '.vixl/skills/lint/SKILL.md',
    })
  })

  it('errors on a bare name duplicated across members', async () => {
    const result = await runTool('deploy')
    expect(result).toEqual({
      error:
        "Skill 'deploy' is defined in multiple projects. Use one of: api:deploy, web:deploy",
    })
  })

  it('keeps primary-root loading when members are absent', async () => {
    const result = await runTool('deploy', { ...ctx, members: undefined })
    expect(result).toMatchObject({
      name: 'deploy',
      content: 'API deploy body',
    })
  })
})
