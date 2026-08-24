import { tool } from 'ai'
import { z } from 'zod'
import { lspEnsureServer, lspRequest } from '@/services/vixl/vixl-tauri'
import { parseLspDiagnosticItems } from '@/services/harness/lsp/parse-diagnostics'
const diagnostics = () =>
  tool({
    description: 'Read linter and diagnostic errors for a file via LSP',
    inputSchema: z.object({
      path: z.string(),
      extension: z.string().optional(),
    }),
    execute: async ({ path, extension }) => {
      const ext = extension ?? path.split('.').pop() ?? ''
      const server = await lspEnsureServer(ext).catch((error: unknown) => ({
        id: '',
        running: false,
        error: error instanceof Error ? error.message : 'LSP ensure failed',
        installState: 'error' as string | null,
      }))
      if (server.installState === 'installing') {
        return {
          path,
          diagnostics: [],
          error: 'installing',
          installState: 'installing',
        }
      }
      if (!server.running) {
        return {
          path,
          diagnostics: [],
          error: server.error ?? 'LSP unavailable',
          installState: server.installState ?? null,
        }
      }

      const result = await lspRequest(server.id, 'diagnostics', { path }).catch(
        (error: unknown) => ({
          error: error instanceof Error ? error.message : 'Diagnostics request failed',
        }),
      )

      if (result && typeof result === 'object' && 'error' in result) {
        return {
          path,
          diagnostics: [],
          error: String((result as { error: string }).error),
        }
      }

      return { path, diagnostics: parseLspDiagnosticItems(result) }
    },
  })

export default diagnostics
