import { toast } from 'vue-sonner'
import * as monaco from 'monaco-editor'
import { fsReadFile, fsWriteFile, gitShowFile } from '@/services/vixl/vixl-tauri'
import formatMonacoError from '@/utils/format-monaco-error'
import { detectMonacoLanguage } from '@/utils/monaco-language'
import { ensureMonacoLanguage } from '@/utils/monaco-shiki'
import { GIT_HEAD_SCHEME, workingFileUri } from '@/utils/monaco-working-uri'
import { ensureLanguageRegistered } from './helpers'
import type { MonacoHelpers } from './helpers'
import type { MonacoLsp } from './lsp'
import type { MonacoEditorContext } from './types'

type ModelsDeps = {
  helpers: MonacoHelpers
  lsp: MonacoLsp
  attachModelRef: { current: ((path: string) => Promise<void>) | null }
}

export const createModels = (ctx: MonacoEditorContext, deps: ModelsDeps) => {
  const contentListeners = new Map<string, monaco.IDisposable>()
  let suppressDirtyCount = 0

  const withoutDirty = <T>(fn: () => T): T => {
    suppressDirtyCount += 1
    try {
      return fn()
    } finally {
      suppressDirtyCount -= 1
    }
  }

  const setModelValueQuiet = (
    model: monaco.editor.ITextModel,
    content: string,
  ): void => {
    withoutDirty(() => {
      if (model.getValue() !== content) {
        model.setValue(content)
      }
    })
  }

  const attachContentListener = (
    path: string,
    model: monaco.editor.ITextModel,
  ): void => {
    contentListeners.get(path)?.dispose()
    const disposable = model.onDidChangeContent(() => {
      if (suppressDirtyCount > 0) {
        return
      }
      deps.helpers.setPathDirty(path, true)
      if (ctx.lspActive.value) {
        deps.lsp.debouncedRefreshDiagnostics(path, model)
      }
    })
    contentListeners.set(path, disposable)
  }

  const getOrCreateOriginalModel = async (
    path: string,
  ): Promise<monaco.editor.ITextModel> => {
    const root = ctx.projectRoot.value
    if (!root) {
      throw new Error('Project not found')
    }

    let content = ''
    try {
      const result = await gitShowFile({ projectRoot: root, path })
      content = result.content
    } catch (error) {
      toast.error('Failed to load HEAD version', {
        description: formatMonacoError(error),
      })
    }

    const existing = ctx.originalModels.get(path)
    if (existing) {
      setModelValueQuiet(existing, content)
      return existing
    }

    const languageId = detectMonacoLanguage(path)
    ensureLanguageRegistered(languageId)
    const uri = monaco.Uri.parse(`${GIT_HEAD_SCHEME}://${encodeURIComponent(path)}`)
    const model = monaco.editor.createModel(content, languageId, uri)
    ctx.originalModels.set(path, model)
    ensureMonacoLanguage(monaco, languageId).catch(() => {
      // Highlighting is best-effort; the model already has content.
    })
    return model
  }

  const getOrCreateModel = async (
    path: string,
    options?: { allowMissing?: boolean },
  ): Promise<monaco.editor.ITextModel> => {
    const existing = ctx.models.get(path)
    const root = ctx.projectRoot.value
    if (!root) {
      throw new Error('Project not found')
    }

    if (existing) {
      if (options?.allowMissing && !deps.helpers.isPathDirty(path)) {
        try {
          const result = await fsReadFile({ projectRoot: root, path })
          setModelValueQuiet(existing, result.content)
        } catch {
          setModelValueQuiet(existing, '')
        }
      }
      return existing
    }

    let content = ''
    try {
      const result = await fsReadFile({ projectRoot: root, path })
      content = result.content
    } catch (error) {
      if (!options?.allowMissing) {
        throw error
      }
    }

    const languageId = detectMonacoLanguage(path)
    ensureLanguageRegistered(languageId)
    const uri = workingFileUri(path)
    const model = monaco.editor.createModel(content, languageId, uri)
    ctx.models.set(path, model)
    ctx.pathByModel.set(model, path)
    attachContentListener(path, model)

    // Upgrade highlighting in the background; do not block showing file contents.
    ensureMonacoLanguage(monaco, languageId).catch(() => {
      // Highlighting is best-effort; the model already has content.
    })

    return model
  }

  const attachDiffModels = async (path: string): Promise<void> => {
    const activeDiff = ctx.diffEditor
    if (!activeDiff) {
      return
    }

    const [original, modified] = await Promise.all([
      getOrCreateOriginalModel(path),
      getOrCreateModel(path, { allowMissing: true }),
    ])

    if (ctx.diffEditor !== activeDiff) {
      return
    }

    activeDiff.setModel({ original, modified })
    deps.helpers.layoutEditor()
  }

  const attachModel = async (path: string): Promise<void> => {
    const activeEditor = ctx.editor
    if (!activeEditor) {
      return
    }

    const model = await getOrCreateModel(path)
    if (ctx.editor !== activeEditor) {
      return
    }

    activeEditor.setModel(model)

    await deps.lsp.setupLspForPath(path, model)

    ctx.emit('dirty-change', { path, dirty: deps.helpers.isPathDirty(path) })
    deps.helpers.layoutEditor()
  }

  deps.attachModelRef.current = attachModel

  const reloadFromDisk = async (path: string): Promise<void> => {
    const root = ctx.projectRoot.value
    const model = ctx.models.get(path)
    if (!root || !model) {
      return
    }

    try {
      const result = await fsReadFile({ projectRoot: root, path })
      setModelValueQuiet(model, result.content)
      deps.helpers.setPathDirty(path, false)
    } catch {
      setModelValueQuiet(model, '')
      deps.helpers.setPathDirty(path, false)
    }
  }

  const disposeModel = (path: string): void => {
    const model = ctx.models.get(path)
    if (!model) {
      return
    }

    contentListeners.get(path)?.dispose()
    contentListeners.delete(path)

    deps.lsp.teardownLspForPath(path, model).catch(() => {
      deps.lsp.clearLspMarkers(model)
      ctx.lspServerByPath.delete(path)
    })

    if (ctx.editor?.getModel() === model) {
      ctx.editor.setModel(null)
    }

    const diffModel = ctx.diffEditor?.getModel()
    if (diffModel?.modified === model) {
      ctx.diffEditor?.setModel(null)
    }

    const original = ctx.originalModels.get(path)
    if (original) {
      original.dispose()
      ctx.originalModels.delete(path)
    }

    ctx.pathByModel.delete(model)
    model.dispose()
    ctx.models.delete(path)
    ctx.dirtyByPath.delete(path)
    ctx.lastLspContentByPath.delete(path)
  }

  const syncOpenModels = (openPaths: string[]): void => {
    for (const path of ctx.models.keys()) {
      if (!openPaths.includes(path)) {
        disposeModel(path)
      }
    }
  }

  const save = async (targetPath?: string): Promise<boolean> => {
    const root = ctx.projectRoot.value
    const path = targetPath ?? ctx.props.path
    if (!root || !path || !ctx.editor || ctx.props.diffView || ctx.saving.value) {
      return false
    }

    if (ctx.editor.getModel() !== ctx.models.get(path)) {
      await attachModel(path)
    }

    const model = ctx.editor.getModel()
    if (!model) {
      return false
    }

    ctx.saving.value = true
    try {
      const content = model.getValue()
      await fsWriteFile({ projectRoot: root, path, content })
      deps.helpers.setPathDirty(path, false)
      ctx.emit('saved', { path, content })
      if (ctx.lspActive.value) {
        await deps.lsp.refreshDiagnostics(path, model)
      }
      toast.success('Saved')
      return true
    } catch (error) {
      toast.error('Failed to save file', {
        description: formatMonacoError(error),
      })
      return false
    } finally {
      ctx.saving.value = false
    }
  }

  return {
    getOrCreateOriginalModel,
    getOrCreateModel,
    attachDiffModels,
    attachModel,
    reloadFromDisk,
    disposeModel,
    syncOpenModels,
    save,
  }
}

export type MonacoModels = ReturnType<typeof createModels>
