import { beforeEach, describe, expect, it } from 'vitest'
import { finishSubagentWithError } from '@/services/harness/subagent/helpers'
import {
  abortOne,
  getSubagent,
  listDeliverableBackgroundResults,
  register,
  resetSubagentRegistryForTests,
} from '@/services/harness/subagent/registry'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { VixlSettings } from '@/types/vixl/vixl-settings'

const ctx = (): HarnessToolContext => ({
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
})

const registerBackground = (controller: AbortController): void => {
  register('chat-1', 'sub-1', controller, {
    toolCallId: 'tc-1',
    agentName: 'explorer',
    prompt: 'task',
    model: 'local::qwen',
    capabilities: 'read-only',
  })
}

describe('finishSubagentWithError', () => {
  beforeEach(() => {
    resetSubagentRegistryForTests()
  })

  it('fails a background subagent when the provider says aborted but the controller is not', () => {
    const controller = new AbortController()
    registerBackground(controller)

    finishSubagentWithError(ctx(), {
      subagentId: 'sub-1',
      error: new Error('This operation was aborted'),
      blocking: false,
      aborted: controller.signal.aborted,
    })

    expect(controller.signal.aborted).toBe(false)
    expect(getSubagent('sub-1')?.status).toBe('failed')
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([
      {
        toolCallId: 'tc-1',
        result: {
          subagentId: 'sub-1',
          name: 'explorer',
          summary: 'This operation was aborted',
        },
      },
    ])
  })

  it('keeps an explicit abortOne as aborted', () => {
    const controller = new AbortController()
    registerBackground(controller)
    abortOne('sub-1')

    finishSubagentWithError(ctx(), {
      subagentId: 'sub-1',
      error: new Error('This operation was aborted'),
      blocking: false,
      aborted: controller.signal.aborted,
    })

    expect(controller.signal.aborted).toBe(true)
    expect(getSubagent('sub-1')?.status).toBe('aborted')
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
  })

  it('aborts a still-running subagent when its controller is aborted', () => {
    const controller = new AbortController()
    registerBackground(controller)
    controller.abort()

    finishSubagentWithError(ctx(), {
      subagentId: 'sub-1',
      error: new Error('generate failed'),
      blocking: false,
      aborted: controller.signal.aborted,
    })

    expect(getSubagent('sub-1')?.status).toBe('aborted')
    expect(getSubagent('sub-1')?.result?.summary).toBe('Stopped')
    expect(listDeliverableBackgroundResults('chat-1')).toEqual([])
  })
})
