import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VixlSettings } from '@/types/vixl/vixl-settings'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import { mockVixlTauri } from '../../../test-utils/mocks/vixl-tauri'

const fsReadFile = vi.hoisted(() =>
  vi.fn<
    (args: {
      projectRoot: string
      path: string
      offset?: number
      limit?: number
      includeBase64?: boolean
    }) => Promise<{
      path: string
      content: string
      totalLines: number
      offset: number
      limit: number
      isImage?: boolean
      mimeType?: string
      sizeBytes?: number
      base64?: string
    }>
  >(),
)

vi.mock('@/services/vixl/vixl-tauri', () =>
  mockVixlTauri({
    fsReadFile: (
      args: {
        projectRoot: string
        path: string
        offset?: number
        limit?: number
        includeBase64?: boolean
      },
    ) => fsReadFile(args),
  }),
)

import readFile from '@/services/harness/read/file'

const baseCtx = (overrides?: Partial<HarnessToolContext>): HarnessToolContext => ({
  projectRoot: '/tmp/project',
  projectSlug: 'project',
  chatId: 'chat-1',
  mode: 'agent',
  settings: { version: 1 } as VixlSettings,
  permissionLevel: 'ask',
  sessionAllows: new Set(),
  sessionDenies: new Set(),
  sandboxEnabled: true,
  supportsVision: false,
  onPendingApproval: () => {},
  ...overrides,
})

const execute = async (
  input: Record<string, unknown>,
  ctx: HarnessToolContext = baseCtx(),
): Promise<unknown> => {
  const built = readFile(ctx)
  const runner = built.execute as (
    value: Record<string, unknown>,
    options: { toolCallId: string },
  ) => Promise<unknown>
  return runner(input, { toolCallId: 'call-1' })
}

describe('read_file tool images', () => {
  beforeEach(() => {
    fsReadFile.mockReset()
  })

  it('stages vision images and omits base64', async () => {
    const stageImage = vi.fn<
      (image: { dataUrl: string; mediaType: string; source: string }) => Promise<void>
    >(async () => undefined)
    fsReadFile.mockResolvedValueOnce({
      path: 'shot.png',
      content: '',
      totalLines: 0,
      offset: 1,
      limit: 0,
      isImage: true,
      mimeType: 'image/png',
      sizeBytes: 12,
    })
    fsReadFile.mockResolvedValueOnce({
      path: 'shot.png',
      content: '',
      totalLines: 0,
      offset: 1,
      limit: 0,
      isImage: true,
      mimeType: 'image/png',
      sizeBytes: 12,
      base64: 'aaaa',
    })

    const result = await execute(
      { path: 'shot.png' },
      baseCtx({ supportsVision: true, stageImage }),
    )

    expect(fsReadFile).toHaveBeenNthCalledWith(1, {
      projectRoot: '/tmp/project',
      path: 'shot.png',
      offset: undefined,
      limit: undefined,
      includeBase64: undefined,
    })
    expect(fsReadFile).toHaveBeenNthCalledWith(2, {
      projectRoot: '/tmp/project',
      path: 'shot.png',
      includeBase64: true,
    })
    expect(stageImage).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,aaaa',
      mediaType: 'image/png',
      source: 'shot.png',
    })
    expect(result).toEqual({
      path: 'shot.png',
      isImage: true,
      loadedIntoContext: true,
      mimeType: 'image/png',
      sizeBytes: 12,
    })
    expect(result).not.toHaveProperty('base64')
  })

  it('keeps metadata and base64 when stageImage is absent', async () => {
    fsReadFile.mockResolvedValue({
      path: 'shot.png',
      content: '',
      totalLines: 0,
      offset: 1,
      limit: 0,
      isImage: true,
      mimeType: 'image/png',
      sizeBytes: 12,
      base64: 'aaaa',
    })

    const result = await execute(
      { path: 'shot.png', include_base64: true },
      baseCtx({ supportsVision: false }),
    )

    expect(fsReadFile).toHaveBeenCalledTimes(1)
    expect(fsReadFile).toHaveBeenCalledWith({
      projectRoot: '/tmp/project',
      path: 'shot.png',
      offset: undefined,
      limit: undefined,
      includeBase64: true,
    })
    expect(result).toEqual({
      path: 'shot.png',
      isImage: true,
      mimeType: 'image/png',
      sizeBytes: 12,
      content: null,
      base64: 'aaaa',
    })
  })

  it('returns a tool error when stageImage throws', async () => {
    const stageImage = vi.fn<
      (image: { dataUrl: string; mediaType: string; source: string }) => Promise<void>
    >(async () => {
      throw new Error('Image could not be compressed under the 3.75MB provider limit')
    })
    fsReadFile.mockResolvedValueOnce({
      path: 'shot.png',
      content: '',
      totalLines: 0,
      offset: 1,
      limit: 0,
      isImage: true,
      mimeType: 'image/png',
      sizeBytes: 12,
      base64: 'aaaa',
    })

    const result = await execute(
      { path: 'shot.png', include_base64: true },
      baseCtx({ supportsVision: true, stageImage }),
    )

    expect(stageImage).toHaveBeenCalledWith({
      dataUrl: 'data:image/png;base64,aaaa',
      mediaType: 'image/png',
      source: 'shot.png',
    })
    expect(result).toEqual({
      path: 'shot.png',
      isImage: true,
      mimeType: 'image/png',
      sizeBytes: 12,
      content: null,
      base64: null,
      error: 'Image could not be compressed under the 3.75MB provider limit',
    })
    expect(result).not.toHaveProperty('loadedIntoContext')
  })

  it('returns text file results unchanged', async () => {
    const textResult = {
      path: 'src/a.ts',
      content: 'export const a = 1',
      totalLines: 1,
      offset: 1,
      limit: 200,
    }
    fsReadFile.mockResolvedValue(textResult)

    await expect(execute({ path: 'src/a.ts', offset: 1, limit: 20 })).resolves.toEqual(
      textResult,
    )
  })
})
