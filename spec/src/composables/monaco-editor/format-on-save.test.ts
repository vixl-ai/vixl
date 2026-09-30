import { describe, expect, it, vi } from 'vitest'
import {
  canApplyFormatEdits,
  runFormatBeforeSave,
  shouldFormatBeforeSave,
} from '@/composables/monaco-editor/format-on-save'
import type * as monaco from 'monaco-editor'

const edit = {
  range: {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 2,
  },
  text: 'x',
}

const createFakeModel = (versionId: number) => {
  const pushStackElement = vi.fn<() => void>()
  const pushEditOperations = vi.fn<
    (
      beforeCursorState: unknown,
      editOperations: unknown,
      cursorStateComputer: unknown,
    ) => unknown
  >()
  const model = {
    getVersionId: () => versionId,
    pushStackElement,
    pushEditOperations,
  } as unknown as monaco.editor.ITextModel
  return { model, pushStackElement, pushEditOperations }
}

describe('shouldFormatBeforeSave', () => {
  it('formats only for enabled non-silent active-path saves', () => {
    expect(
      shouldFormatBeforeSave({
        enabled: true,
        isActivePath: true,
      }),
    ).toBe(true)
  })

  it('skips formatting for silent saves', () => {
    expect(
      shouldFormatBeforeSave({
        enabled: true,
        silent: true,
        isActivePath: true,
      }),
    ).toBe(false)
  })

  it('skips formatting when formatOnSave is off', () => {
    expect(
      shouldFormatBeforeSave({
        enabled: false,
        isActivePath: true,
      }),
    ).toBe(false)
  })

  it('skips formatting for non-active paths', () => {
    expect(
      shouldFormatBeforeSave({
        enabled: true,
        isActivePath: false,
      }),
    ).toBe(false)
  })
})

describe('canApplyFormatEdits', () => {
  it('applies when edits arrive in time on an unchanged model', () => {
    expect(
      canApplyFormatEdits(3, 3, { timedOut: false, edits: [edit] }),
    ).toBe(true)
  })

  it('drops timed out races', () => {
    expect(canApplyFormatEdits(3, 3, { timedOut: true })).toBe(false)
  })

  it('drops empty edit lists', () => {
    expect(
      canApplyFormatEdits(3, 3, { timedOut: false, edits: [] }),
    ).toBe(false)
  })

  it('drops late results when the model version changed', () => {
    expect(
      canApplyFormatEdits(3, 4, { timedOut: false, edits: [edit] }),
    ).toBe(false)
  })
})

describe('runFormatBeforeSave', () => {
  it('applies edits on the formatted model', async () => {
    const { model, pushStackElement, pushEditOperations } = createFakeModel(1)

    await runFormatBeforeSave({
      model,
      requestFormattingEdits: async () => [edit],
    })

    expect(pushStackElement).toHaveBeenCalledTimes(2)
    expect(pushEditOperations).toHaveBeenCalledTimes(1)
    expect(pushEditOperations.mock.calls[0]?.[1]).toEqual([
      {
        range: edit.range,
        text: edit.text,
        forceMoveMarkers: true,
      },
    ])
  })

  it('does not apply edits after timeout', async () => {
    vi.useFakeTimers()
    const { model, pushStackElement, pushEditOperations } = createFakeModel(1)

    try {
      const pending = runFormatBeforeSave({
        model,
        requestFormattingEdits: () => new Promise(() => {}),
      })

      await vi.advanceTimersByTimeAsync(3_000)
      await pending

      expect(pushStackElement).not.toHaveBeenCalled()
      expect(pushEditOperations).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not apply edits when the model version changed', async () => {
    let versionId = 1
    const pushStackElement = vi.fn<() => void>()
    const pushEditOperations = vi.fn<
      (
        beforeCursorState: unknown,
        editOperations: unknown,
        cursorStateComputer: unknown,
      ) => unknown
    >()
    const model = {
      getVersionId: () => versionId,
      pushStackElement,
      pushEditOperations,
    } as unknown as monaco.editor.ITextModel

    await runFormatBeforeSave({
      model,
      requestFormattingEdits: async () => {
        versionId = 2
        return [edit]
      },
    })

    expect(pushStackElement).not.toHaveBeenCalled()
    expect(pushEditOperations).not.toHaveBeenCalled()
  })
})
