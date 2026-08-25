import { tool } from 'ai'
import { z } from 'zod'
import convertWebContent from '@/services/harness/web/convert'
import parseFetchUrl from '@/services/harness/web/parse-fetch-url'
import webFetchSessionCache from '@/services/harness/web/session-cache'
import truncateWebText from '@/services/harness/web/truncate'
import wrapUntrustedWebContent from '@/services/harness/web/wrap-untrusted'
import { gateToolPermission } from '@/services/harness/permission/gate'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import withToolExamples from '@/services/harness/with-tool-examples'
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

const webFetchTool = (ctx: HarnessToolContext) =>
  tool({
    description: withToolExamples(
      [
        'Fetch an http(s) URL and return markdown (default), text, or html. Plain HTTP GET, no JavaScript.',
        'Works for any host including git forges (GitLab, Gitea, Forgejo, Bitbucket, Codeberg, github.com). Do not refuse github.com.',
        'If this machine has gh and the URL is github.com, the shell tool with gh pr view / gh issue view / gh api can be better for private GitHub data. Otherwise fetch the URL.',
      ].join(' '),
      [
        { url: 'https://example.com/docs' },
        { url: 'https://example.com/page', format: 'text', max_length: 8000 },
      ],
    ),
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
