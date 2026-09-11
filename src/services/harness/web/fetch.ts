import { tool } from 'ai'
import { z } from 'zod'
import convertWebContent from '@/services/harness/web/convert'
import parseFetchUrl from '@/services/harness/web/parse-fetch-url'
import webFetchSessionCache from '@/services/harness/web/session-cache'
import truncateWebText from '@/services/harness/web/truncate'
import wrapUntrustedWebContent from '@/services/harness/web/wrap-untrusted'
import { gateToolPermission } from '@/services/harness/permission/gate'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import webFetch from '@/services/vixl/vixl-tauri/web-fetch'
import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { WebFetchFormat } from '@/types/harness/web-content'

const DEFAULT_MAX_LENGTH = 32000

const SPA_GET_HINT =
  'This response looks like a JS SPA shell or bot challenge page from a plain HTTP GET (no JavaScript).'

const headerValue = (
  headers: Record<string, string>,
  name: string,
): string | undefined => {
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value
    }
  }
  return undefined
}

const imageMediaType = (contentType: string): string => {
  const mime = contentType.split(';')[0]?.trim()
  return mime || contentType
}

const webFetchTool = (ctx: HarnessToolContext) =>
  tool({
    description:
      'Fetch an http(s) URL as markdown (default), text, or html. No JavaScript. Image URLs are loaded into context automatically for vision models.',
    inputSchema: z.object({
      url: z.string().describe('http or https URL to fetch'),
      max_length: z
        .number()
        .optional()
        .describe(`Max characters to return (default ${DEFAULT_MAX_LENGTH})`),
      start_index: z
        .number()
        .optional()
        .describe('Character offset into converted text (default 0)'),
      format: z
        .enum(['markdown', 'text', 'html'])
        .optional()
        .describe('Output format (default markdown)'),
    }),
    execute: async (
      { url, max_length, start_index, format },
      { toolCallId },
    ) => {
      const parsed = parseFetchUrl(url)
      if (!parsed.ok) {
        return { error: parsed.error }
      }

      const formatValue: WebFetchFormat = format ?? 'markdown'
      const maxLength = max_length ?? DEFAULT_MAX_LENGTH
      const startIndex = start_index ?? 0
      const capability = `web.fetch:${parsed.hostname}` as const

      const allowed = await gateToolPermission({
        ctx: toPermCtx(ctx),
        toolCallId,
        name: 'web_fetch',
        kind: 'web',
        action: 'web.fetch',
        capability,
        title: parsed.href,
      })
      if (!allowed) {
        return { rejected: true, error: 'Web fetch denied' }
      }

      const cacheKey = webFetchSessionCache.makeKey(
        ctx.chatId,
        formatValue,
        parsed.href,
      )
      let cached = webFetchSessionCache.get(cacheKey)

      if (!cached) {
        let response: Awaited<ReturnType<typeof webFetch>>
        try {
          response = await webFetch({ url: parsed.href, format: formatValue })
        } catch (error) {
          return {
            error:
              error instanceof Error ? error.message : 'Web fetch failed',
          }
        }

        if (response.status >= 300 && response.status < 400) {
          const location = headerValue(response.headers, 'location')
          return {
            status: response.status,
            location: location ?? null,
            error:
              'Redirects are not followed. Call web_fetch again with the Location URL if that host is intended.',
          }
        }

        const contentType =
          headerValue(response.headers, 'content-type') ?? ''

        if (response.isImage) {
          if (!ctx.stageImage) {
            return {
              error:
                'This URL is an image and this model cannot view images.',
              status: response.status,
              contentType,
            }
          }

          if (!response.bodyBase64) {
            return {
              error: 'Image response was missing body data.',
              status: response.status,
              contentType,
            }
          }

          const mediaType = imageMediaType(contentType)
          try {
            await ctx.stageImage({
              dataUrl: `data:${mediaType};base64,${response.bodyBase64}`,
              mediaType,
              source: parsed.href,
            })
          } catch (error) {
            return {
              error:
                error instanceof Error
                  ? error.message
                  : 'Failed to load image into context',
              status: response.status,
              contentType,
            }
          }

          return {
            status: response.status,
            contentType,
            isImage: true as const,
            loadedIntoContext: true as const,
          }
        }

        const converted = convertWebContent({
          body: response.body,
          contentType,
          format: formatValue,
        })
        if (!converted.ok) {
          return { error: converted.error, status: response.status, contentType }
        }

        cached = {
          status: response.status,
          contentType,
          text: converted.text,
          kind: converted.kind,
          spaShell: converted.spaShell,
          challenge: converted.challenge,
        }
        webFetchSessionCache.set(cacheKey, cached)
      }

      const truncated = truncateWebText({
        text: cached.text,
        maxLength,
        startIndex,
      })
      const wrapped = wrapUntrustedWebContent(parsed.href, truncated.text)
      const needsSpaHint = cached.spaShell || cached.challenge

      return {
        status: cached.status,
        contentType: cached.contentType,
        kind: cached.kind,
        spaShell: cached.spaShell,
        challenge: cached.challenge,
        truncated: truncated.truncated,
        ...(truncated.nextStartIndex !== undefined
          ? { nextStartIndex: truncated.nextStartIndex }
          : {}),
        ...(needsSpaHint ? { hint: SPA_GET_HINT } : {}),
        text: wrapped,
      }
    },
  })

export default webFetchTool
