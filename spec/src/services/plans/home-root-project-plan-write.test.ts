import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockVixlTauri } from '../../test-utils/mocks/vixl-tauri'
import { HOME_PROJECT_SCOPE_ERROR } from '@/services/config/is-home-workspace-root'

const { fsWriteFile, getVixlDir, getUserHomeDir } = vi.hoisted(() => ({
  fsWriteFile: vi.fn<
    (args: { projectRoot: string; path: string; content: string }) => Promise<unknown>
  >(async () => undefined),
  getVixlDir: vi.fn<(scope: string) => Promise<string>>(async () => '/home/user/.vixl'),
  getUserHomeDir: vi.fn<() => Promise<string>>(async () => '/Users/test-home'),
}))

vi.mock('@/services/vixl/vixl-tauri/home-dir', () => ({
  getUserHomeDir,
}))

vi.mock('@/services/vixl/vixl-tauri/helpers', async () => {
  const { createHomeWorkspaceHelpersMock } = await import(
    '../../test-utils/mocks/home-workspace-command'
  )
  return createHomeWorkspaceHelpersMock(getUserHomeDir)
})

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsWriteFile,
    getVixlDir,
  }),
)

import writePlanFile from '@/services/plans/write-plan-file'

const homeRoot = '/Users/test-home'
const projectRoot = '/tmp/proj'
const personalDir = '/home/user/.vixl'
const planFilePattern = String.raw`ship-the-app-\d{4}-\d{2}-\d{2}-\d{6}/PLAN\.md`

beforeEach(() => {
  fsWriteFile.mockReset()
  getVixlDir.mockReset()
  getUserHomeDir.mockReset()
  fsWriteFile.mockResolvedValue(undefined)
  getVixlDir.mockResolvedValue(personalDir)
  getUserHomeDir.mockResolvedValue(`${homeRoot}/`)
})

describe('project-scoped plan writes on the home directory', () => {
  it('refuses a project-scoped plan write for the home directory', async () => {
    await expect(
      writePlanFile({
        scope: 'project',
        projectRoot: homeRoot,
        title: 'Ship the app',
        body: 'steps',
      }),
    ).rejects.toThrow(HOME_PROJECT_SCOPE_ERROR)
    await expect(
      writePlanFile({
        scope: 'project',
        projectRoot: `${homeRoot}/`,
        title: 'Ship the app',
        body: 'steps',
      }),
    ).rejects.toThrow(HOME_PROJECT_SCOPE_ERROR)

    expect(fsWriteFile).not.toHaveBeenCalled()
    expect(getVixlDir).not.toHaveBeenCalled()
  })

  it('still writes a project plan for a real project root', async () => {
    const plan = await writePlanFile({
      scope: 'project',
      projectRoot,
      title: 'Ship the app',
      body: 'steps',
    })

    expect(plan.path).toMatch(new RegExp(`^\\.vixl/plans/${planFilePattern}$`))
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot,
        path: plan.path,
        content: expect.stringContaining('Ship the app'),
      }),
    )
    expect(getVixlDir).not.toHaveBeenCalled()
  })

  it('still writes a personal plan when the home directory is passed as projectRoot', async () => {
    const plan = await writePlanFile({
      scope: 'personal',
      projectRoot: homeRoot,
      title: 'Ship the app',
      body: 'steps',
    })

    expect(plan.path).toMatch(new RegExp(`^plans/${planFilePattern}$`))
    expect(getVixlDir).toHaveBeenCalledWith('personal')
    expect(fsWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        projectRoot: personalDir,
        path: plan.path,
        content: expect.stringContaining('Ship the app'),
      }),
    )
  })
})
