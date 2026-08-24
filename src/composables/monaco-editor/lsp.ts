import { useDebounceFn } from '@vueuse/core'
import { toast } from 'vue-sonner'
import * as monaco from 'monaco-editor'
import { lspEnsureServer, lspRequest } from '@/services/vixl/vixl-tauri'
import formatMonacoError from '@/utils/format-monaco-error'
import {
  fileExtension,
  LSP_MARKER_OWNER,
  lspDiagnosticsToMarkers,
  normalizeFileUri,
  parseLspDiagnostics,
  workspacePathToFileUri,
} from '@/utils/monaco-lsp'
import type { LspDiagnosticsEvent, MonacoEditorContext } from './types'

export const createLsp = (ctx: MonacoEditorContext) => {
  const clearLspMarkers = (model: monaco.editor.ITextModel): void => {
    monaco.editor.setModelMarkers(model, LSP_MARKER_OWNER, [])
  }

  const getLspServerId = (path: string): string | null =>
    ctx.lspServerByPath.get(path) ?? null

  /** Vue LS 3 hybrid mode: script hover/defs/completion come from TypeScript + plugin. */
  const serversForLspFeature = (path: string, primaryId: string): string[] => {
    if (primaryId === 'vue' || fileExtension(path) === 'vue') {
      return primaryId === 'vue' ? ['typescript', 'vue'] : ['typescript', primaryId]
    }
    return [primaryId]
  }

  const withLspTimeout = async <T>(
    work: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null
    try {
      return await Promise.race([
        work,
        new Promise<T>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`${label} timed out`))
          }, timeoutMs)
        }),
      ])
    } finally {
      if (timer !== null) {
        clearTimeout(timer)
      }
    }
  }

  const syncDocumentToLsp = async (path: string, content: string): Promise<void> => {
    const serverId = getLspServerId(path)
    if (!ctx.lspActive.value || !serverId) {
      return
    }

    if (ctx.lastLspContentByPath.get(path) === content) {
      return
    }

    await lspRequest(serverId, 'textDocument/didChange', { path, content })
    ctx.lastLspContentByPath.set(path, content)
  }

  const applyDiagnostics = (
    model: monaco.editor.ITextModel,
    result: unknown,
  ): void => {
    const diagnostics = parseLspDiagnostics(result)
    const markers = lspDiagnosticsToMarkers(diagnostics, monaco)
    monaco.editor.setModelMarkers(model, LSP_MARKER_OWNER, markers)
  }

  const findModelForFileUri = (uri: string): monaco.editor.ITextModel | null => {
    const root = ctx.projectRoot.value
    if (!root) {
      return null
    }

    const targetPath = normalizeFileUri(uri)
    for (const [path, model] of ctx.models.entries()) {
      const modelPath = normalizeFileUri(workspacePathToFileUri(root, path))
      if (modelPath === targetPath) {
        return model
      }
    }

    return null
  }

  const handlePushDiagnostics = (payload: LspDiagnosticsEvent): void => {
    if (!ctx.lspActive.value) {
      return
    }

    const model = findModelForFileUri(payload.uri)
    if (!model) {
      return
    }

    const path = ctx.pathByModel.get(model)
    const serverId = path ? getLspServerId(path) : null
    if (!serverId || serverId !== payload.serverId) {
      return
    }

    applyDiagnostics(model, { diagnostics: payload.diagnostics })
  }

  const refreshDiagnostics = async (
    path: string,
    model: monaco.editor.ITextModel,
  ): Promise<void> => {
    const serverId = getLspServerId(path)
    if (!ctx.lspActive.value || !serverId) {
      return
    }

    try {
      await syncDocumentToLsp(path, model.getValue())
      const result = await lspRequest(serverId, 'diagnostics', {
        path,
        content: model.getValue(),
      })
      applyDiagnostics(model, result)
    } catch {
      clearLspMarkers(model)
    }
  }

  const debouncedRefreshDiagnostics = useDebounceFn(
    (path: string, model: monaco.editor.ITextModel) => {
      refreshDiagnostics(path, model).catch(() => {
        clearLspMarkers(model)
      })
    },
    500,
  )

  const closeLspDocument = async (path: string): Promise<void> => {
    const serverId = ctx.lspServerByPath.get(path)
    if (!serverId) {
      return
    }

    try {
      await lspRequest(serverId, 'textDocument/didClose', { path })
    } finally {
      ctx.lspServerByPath.delete(path)
      ctx.lastLspContentByPath.delete(path)
    }
  }

  const teardownLspForPath = async (
    path: string,
    model: monaco.editor.ITextModel,
  ): Promise<void> => {
    clearLspMarkers(model)
    await closeLspDocument(path)
  }

  const setupLspForPath = async (
    path: string,
    model: monaco.editor.ITextModel,
  ): Promise<void> => {
    if (!ctx.lspActive.value) {
      clearLspMarkers(model)
      return
    }

    const extension = fileExtension(path)
    if (!extension) {
      return
    }

    try {
      const root = ctx.projectRoot.value
      if (!root) {
        clearLspMarkers(model)
        return
      }

      const server = await lspEnsureServer(extension, root)
      if (!server.running) {
        ctx.lspServerByPath.delete(path)
        clearLspMarkers(model)
        if (extension === 'java' || extension === '.java') {
          toast.error('Java language server unavailable', {
            description:
              'Install a JDK on PATH, or enable lsp.autoDownload so jdtls can be fetched.',
          })
        }
        return
      }

      ctx.lspServerByPath.set(path, server.id)
      await ctx.lspStatus.refreshCatalog()
      if (server.id === 'vue' || server.id === 'typescript') {
        ctx.lspStatus.markAwaitingProjectLoad(server.id)
      }
      // Vue LS 3 hybrid: script features need TypeScript + @vue/typescript-plugin.
      if (server.id === 'vue') {
        try {
          await lspEnsureServer('ts', root)
          await ctx.lspStatus.refreshCatalog()
        } catch (error) {
          toast.error('TypeScript language server unavailable', {
            description:
              formatMonacoError(error) +
              '. Vue script hover and completions need TypeScript with the Vue plugin.',
          })
        }
      }
      await lspRequest(server.id, 'textDocument/didOpen', {
        path,
        content: model.getValue(),
      })
      ctx.lastLspContentByPath.set(path, model.getValue())
      await refreshDiagnostics(path, model)
    } catch (error) {
      ctx.lspServerByPath.delete(path)
      clearLspMarkers(model)
      const message = formatMonacoError(error)
      if (
        extension === 'java' ||
        extension === '.java' ||
        message.toLowerCase().includes('jdk') ||
        message.toLowerCase().includes('jdtls')
      ) {
        toast.error('Java language server failed', {
          description: message,
        })
      }
    }
  }

  const resolvePathForModel = (model: monaco.editor.ITextModel): string | null =>
    ctx.pathByModel.get(model) ?? null

  return {
    clearLspMarkers,
    getLspServerId,
    serversForLspFeature,
    withLspTimeout,
    syncDocumentToLsp,
    applyDiagnostics,
    handlePushDiagnostics,
    refreshDiagnostics,
    debouncedRefreshDiagnostics,
    closeLspDocument,
    teardownLspForPath,
    setupLspForPath,
    resolvePathForModel,
  }
}

export type MonacoLsp = ReturnType<typeof createLsp>
