import * as monaco from 'monaco-editor'
import {
  applyMonacoTheme,
  ensureMonacoAppearanceBridge,
  ensureMonacoBaseThemes,
  observeMonacoTheme,
} from '@/utils/monaco-theme'
import { unregisterMonacoEditorInstance } from '@/utils/appearance/editor-theme'
import { disposeEditorViewStateListeners } from './view-state'
import type { MonacoEditorContext } from './types'

export const hasEditorDimensions = (element: HTMLElement): boolean =>
  element.clientWidth > 0 && element.clientHeight > 0

export const ensureLanguageRegistered = (languageId: string): void => {
  if (
    languageId !== 'plaintext' &&
    !monaco.languages.getLanguages().some((language) => language.id === languageId)
  ) {
    monaco.languages.register({ id: languageId })
  }
}

export const createHelpers = (ctx: MonacoEditorContext) => {
  const hasActiveEditor = (): boolean => ctx.editor !== null || ctx.diffEditor !== null

  const layoutEditor = (): void => {
    ctx.editor?.layout()
    ctx.diffEditor?.layout()
  }

  const prepareMonacoEnvironment = (): void => {
    ensureMonacoBaseThemes(monaco)
    applyMonacoTheme(monaco)

    ctx.stopThemeObserver?.()
    ctx.stopThemeObserver = observeMonacoTheme(monaco, layoutEditor)

    // Attach the shared appearance bridge once; it fans live
    // `vixl:appearance-change` updates out to every tracked editor.
    ensureMonacoAppearanceBridge(monaco)

    // Silence Monaco's built-in TypeScript worker diagnostics. The bundled
    // tsserver worker does not understand Vue SFC or Vite CSS module imports,
    // so it produces false positives (e.g. "Cannot find module './App.vue'")
    // that Cursor/Volar do not show. Accurate diagnostics come from the
    // external LSP (Volar) when language servers are available.
    const tsLang = monaco.languages.typescript as unknown as {
      typescriptDefaults: {
        setDiagnosticsOptions(opts: {
          noSemanticValidation: boolean
          noSyntaxValidation: boolean
        }): void
      }
      javascriptDefaults: {
        setDiagnosticsOptions(opts: {
          noSemanticValidation: boolean
          noSyntaxValidation: boolean
        }): void
      }
    }
    tsLang.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    })
    tsLang.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    })
  }

  const disposeCodeEditor = (): void => {
    disposeEditorViewStateListeners(ctx)
    if (ctx.editor) {
      unregisterMonacoEditorInstance(ctx.editor)
    }
    ctx.editor?.dispose()
    ctx.editor = null
  }

  const disposeDiffEditorInstance = (): void => {
    if (ctx.diffEditor) {
      unregisterMonacoEditorInstance(ctx.diffEditor)
    }
    ctx.diffEditor?.setModel(null)
    ctx.diffEditor?.dispose()
    ctx.diffEditor = null
  }

  const disposeOriginalModels = (): void => {
    for (const model of ctx.originalModels.values()) {
      model.dispose()
    }
    ctx.originalModels.clear()
  }

  const syncEditorViewOptions = (): void => {
    const options = {
      lineNumbers: ctx.lineNumbersOption.value,
      wordWrap: ctx.wordWrapOption.value,
    }
    ctx.editor?.updateOptions(options)
    ctx.diffEditor?.updateOptions(options)
  }

  const setPathDirty = (path: string, dirty: boolean): void => {
    const wasDirty = ctx.dirtyByPath.get(path) ?? false
    if (wasDirty === dirty) {
      return
    }
    ctx.dirtyByPath.set(path, dirty)
    ctx.emit('dirty-change', { path, dirty })
  }

  const isPathDirty = (path: string): boolean => ctx.dirtyByPath.get(path) ?? false

  return {
    hasActiveEditor,
    layoutEditor,
    prepareMonacoEnvironment,
    disposeCodeEditor,
    disposeDiffEditorInstance,
    disposeOriginalModels,
    syncEditorViewOptions,
    setPathDirty,
    isPathDirty,
  }
}

export type MonacoHelpers = ReturnType<typeof createHelpers>
