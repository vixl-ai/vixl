import { toast } from 'vue-sonner'
import * as monaco from 'monaco-editor'
import formatMonacoError from '@/utils/format-monaco-error'
import { ensureMonacoShiki } from '@/utils/monaco-shiki'
import { applyMonacoTheme, resolveMonacoEditorOptions } from '@/utils/monaco-theme'
import type { MonacoHelpers } from './helpers'
import type { MonacoModels } from './models'
import type { MonacoEditorContext } from './types'
import { bindEditorViewStateListeners } from './view-state'

type EditorDeps = {
  helpers: MonacoHelpers
  models: MonacoModels
  save: (targetPath?: string) => Promise<boolean>
}

export const createEditorInstances = (ctx: MonacoEditorContext, deps: EditorDeps) => {
  const createCodeEditorInstance = async (): Promise<boolean> => {
    if (!ctx.containerRef.value || ctx.editor || ctx.diffEditor) {
      return ctx.editor !== null
    }

    const created = monaco.editor.create(ctx.containerRef.value, {
      ...resolveMonacoEditorOptions(),
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: ctx.lineNumbersOption.value,
      wordWrap: ctx.wordWrapOption.value,
    })
    ctx.editor = created

    created.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      deps.save().catch((error) => {
        toast.error('Failed to save file', {
          description: formatMonacoError(error),
        })
      })
    })

    if (ctx.props.path) {
      await deps.models.attachModel(ctx.props.path)
    }

    bindEditorViewStateListeners(ctx)

    return ctx.editor === created
  }

  const createDiffEditorInstance = async (): Promise<boolean> => {
    if (!ctx.containerRef.value || ctx.editor || ctx.diffEditor) {
      return ctx.diffEditor !== null
    }

    const created = monaco.editor.createDiffEditor(ctx.containerRef.value, {
      ...resolveMonacoEditorOptions(),
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      lineNumbers: ctx.lineNumbersOption.value,
      wordWrap: ctx.wordWrapOption.value,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
    })
    ctx.diffEditor = created

    if (ctx.props.path) {
      await deps.models.attachDiffModels(ctx.props.path)
    }

    return ctx.diffEditor === created
  }

  const switchToDiffView = async (): Promise<void> => {
    if (ctx.diffEditor) {
      if (ctx.props.path) {
        await deps.models.attachDiffModels(ctx.props.path)
      }
      return
    }

    deps.helpers.disposeCodeEditor()
    deps.helpers.prepareMonacoEnvironment()
    const created = await createDiffEditorInstance()
    if (!created) {
      return
    }

    try {
      await ensureMonacoShiki(monaco)
      if (ctx.diffEditor) {
        applyMonacoTheme(monaco)
      }
    } catch (error) {
      toast.error('Syntax highlighting unavailable', {
        description: formatMonacoError(error),
      })
    }
  }

  const switchToCodeView = async (): Promise<void> => {
    if (ctx.editor) {
      if (ctx.props.path) {
        await deps.models.attachModel(ctx.props.path)
      }
      return
    }

    deps.helpers.disposeDiffEditorInstance()
    deps.helpers.disposeOriginalModels()
    deps.helpers.prepareMonacoEnvironment()
    const created = await createCodeEditorInstance()
    if (!created) {
      return
    }

    try {
      await ensureMonacoShiki(monaco)
      if (ctx.editor) {
        applyMonacoTheme(monaco)
      }
    } catch (error) {
      toast.error('Syntax highlighting unavailable', {
        description: formatMonacoError(error),
      })
    }
  }

  const initializeEditor = async (): Promise<boolean> => {
    if (
      !ctx.containerRef.value ||
      deps.helpers.hasActiveEditor() ||
      ctx.editorInitializing
    ) {
      return deps.helpers.hasActiveEditor()
    }

    if (!hasEditorDimensionsSafe(ctx.containerRef.value)) {
      return false
    }

    ctx.editorInitializing = true
    try {
      deps.helpers.prepareMonacoEnvironment()

      // Create the editor synchronously first so opening a file never waits on
      // Shiki and cannot race setModel against a null editor.
      const created = ctx.props.diffView
        ? await createDiffEditorInstance()
        : await createCodeEditorInstance()

      if (!created) {
        return false
      }

      try {
        await ensureMonacoShiki(monaco)
        if (deps.helpers.hasActiveEditor()) {
          applyMonacoTheme(monaco)
        }
      } catch (error) {
        toast.error('Syntax highlighting unavailable', {
          description: formatMonacoError(error),
        })
      }

      return deps.helpers.hasActiveEditor()
    } catch (error) {
      toast.error('Failed to initialize editor', {
        description: formatMonacoError(error),
      })
      return false
    } finally {
      ctx.editorInitializing = false
    }
  }

  const tryInitializeEditor = (): void => {
    initializeEditor().catch((error) => {
      toast.error('Failed to initialize editor', {
        description: formatMonacoError(error),
      })
    })
  }

  return {
    createCodeEditorInstance,
    createDiffEditorInstance,
    switchToDiffView,
    switchToCodeView,
    initializeEditor,
    tryInitializeEditor,
  }
}

const hasEditorDimensionsSafe = (element: HTMLElement): boolean =>
  element.clientWidth > 0 && element.clientHeight > 0

export type MonacoEditorInstances = ReturnType<typeof createEditorInstances>
