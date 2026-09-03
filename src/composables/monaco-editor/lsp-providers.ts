import * as monaco from 'monaco-editor'
import { lspRequest } from '@/services/vixl/vixl-tauri'
import {
  parseLspCompletionItems,
  parseLspHoverContents,
  parseLspLocations,
} from '@/utils/monaco-lsp'
import type { MonacoEditorContext } from './types'
import type { MonacoLsp } from './lsp'

export const createLspProviders = (ctx: MonacoEditorContext, lsp: MonacoLsp) => {
  const registerLspProviders = (): void => {
    if (ctx.lspProvidersRegistered) {
      return
    }
    ctx.lspProvidersRegistered = true

    ctx.lspProviderDisposables.push(
      monaco.languages.registerHoverProvider('*', {
        provideHover: async (model, position) => {
          if (!ctx.lspActive.value) {
            return null
          }

          const path = lsp.resolvePathForModel(model)
          if (!path) {
            return null
          }

          let primaryId = lsp.getLspServerId(path)
          if (!primaryId) {
            try {
              await lsp.setupLspForPath(path, model)
            } catch {
              return null
            }
            primaryId = lsp.getLspServerId(path)
          }
          if (!primaryId) {
            return null
          }

          try {
            const result = await lsp.withLspTimeout(
              (async () => {
                await lsp.syncDocumentToLsp(path, model.getValue())
                const positionPayload = {
                  line: position.lineNumber - 1,
                  character: position.column - 1,
                }
                for (const serverId of lsp.serversForLspFeature(path, primaryId)) {
                  try {
                    const candidate = await lspRequest(serverId, 'hover', {
                      path,
                      position: positionPayload,
                    })
                    if (parseLspHoverContents(candidate).length > 0) {
                      return candidate
                    }
                  } catch {
                    continue
                  }
                }
                return null
              })(),
              10_000,
              'Hover',
            )

            const contents = parseLspHoverContents(result)
            if (contents.length === 0) {
              return null
            }

            return {
              range: new monaco.Range(
                position.lineNumber,
                position.column,
                position.lineNumber,
                position.column,
              ),
              contents: contents.map((value) => ({ value })),
            }
          } catch {
            return null
          }
        },
      }),
    )

    ctx.lspProviderDisposables.push(
      monaco.languages.registerDefinitionProvider('*', {
        provideDefinition: async (model, position) => {
          if (!ctx.lspActive.value) {
            return null
          }

          const path = lsp.resolvePathForModel(model)
          const primaryId = path ? lsp.getLspServerId(path) : null
          if (!path || !primaryId) {
            return null
          }

          try {
            await lsp.syncDocumentToLsp(path, model.getValue())
            const positionPayload = {
              line: position.lineNumber - 1,
              character: position.column - 1,
            }
            let locations: ReturnType<typeof parseLspLocations> = []
            for (const serverId of lsp.serversForLspFeature(path, primaryId)) {
              try {
                const result = await lspRequest(serverId, 'goToDefinition', {
                  path,
                  position: positionPayload,
                })
                locations = parseLspLocations(result)
                if (locations.length > 0) {
                  break
                }
              } catch {
                continue
              }
            }
            if (locations.length === 0) {
              return null
            }

            return locations.map((location) => ({
              uri: monaco.Uri.parse(location.uri),
              range: new monaco.Range(
                location.range.start.line + 1,
                location.range.start.character + 1,
                location.range.end.line + 1,
                location.range.end.character + 1,
              ),
            }))
          } catch {
            return null
          }
        },
      }),
    )

    ctx.lspProviderDisposables.push(
      monaco.languages.registerCompletionItemProvider('*', {
        triggerCharacters: ['.', '"', "'", '/', '<', ':'],
        provideCompletionItems: async (model, position) => {
          if (!ctx.lspActive.value) {
            return { suggestions: [] }
          }

          const path = lsp.resolvePathForModel(model)
          const primaryId = path ? lsp.getLspServerId(path) : null
          if (!path || !primaryId) {
            return { suggestions: [] }
          }

          try {
            await lsp.syncDocumentToLsp(path, model.getValue())
            const positionPayload = {
              line: position.lineNumber - 1,
              character: position.column - 1,
            }
            for (const serverId of lsp.serversForLspFeature(path, primaryId)) {
              try {
                const result = await lspRequest(serverId, 'textDocument/completion', {
                  path,
                  position: positionPayload,
                })
                const suggestions = parseLspCompletionItems(result, monaco)
                if (suggestions.length > 0) {
                  return { suggestions }
                }
              } catch {
                continue
              }
            }
            return { suggestions: [] }
          } catch {
            return { suggestions: [] }
          }
        },
      }),
    )
  }

  return { registerLspProviders }
}
