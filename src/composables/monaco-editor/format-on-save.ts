import type * as monaco from 'monaco-editor'

const FORMAT_ON_SAVE_TIMEOUT_MS = 3_000

type FormatOnSaveRaceResult =
  | { timedOut: true }
  | { timedOut: false; edits: monaco.languages.TextEdit[] }

export const shouldFormatBeforeSave = (options: {
  enabled: boolean
  silent?: boolean
  isActivePath: boolean
}): boolean =>
  options.enabled && !options.silent && options.isActivePath

export const canApplyFormatEdits = (
  versionAtRequest: number,
  versionNow: number,
  result: FormatOnSaveRaceResult,
): result is { timedOut: false; edits: monaco.languages.TextEdit[] } =>
  !result.timedOut && result.edits.length > 0 && versionAtRequest === versionNow

export const runFormatBeforeSave = async (options: {
  model: monaco.editor.ITextModel
  requestFormattingEdits: (
    model: monaco.editor.ITextModel,
  ) => Promise<monaco.languages.TextEdit[]>
}): Promise<void> => {
  const { model } = options
  const versionAtRequest = model.getVersionId()
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const result = await Promise.race([
      options.requestFormattingEdits(model).then(
        (edits): FormatOnSaveRaceResult => ({ timedOut: false, edits }),
      ),
      new Promise<FormatOnSaveRaceResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({ timedOut: true })
        }, FORMAT_ON_SAVE_TIMEOUT_MS)
      }),
    ])

    if (!canApplyFormatEdits(versionAtRequest, model.getVersionId(), result)) {
      return
    }

    const operations = result.edits.map((edit) => ({
      range: edit.range,
      text: edit.text,
      forceMoveMarkers: true,
    }))
    model.pushStackElement()
    model.pushEditOperations([], operations, () => null)
    model.pushStackElement()
  } catch {
    return
  } finally {
    if (timer !== null) {
      clearTimeout(timer)
    }
  }
}
