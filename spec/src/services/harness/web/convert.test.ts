import { describe, expect, it } from 'vitest'
import convertWebContent from '@/services/harness/web/convert'
import isSpaShell from '@/services/harness/web/is-spa-shell'
import truncateWebText from '@/services/harness/web/truncate'

const ARTICLE_HTML = `<!DOCTYPE html>
<html>
<head><title>Docs Guide</title></head>
<body>
  <nav>Home Docs Pricing Login</nav>
  <header>Site Chrome Header</header>
  <article>
    <h1>Installing Vixl</h1>
    <p>
      This article explains how to install Vixl on your workstation with enough
      prose for Readability to treat it as the primary document content rather
      than navigation chrome or marketing footer copy.
    </p>
    <p>
      Follow the setup steps carefully, then verify the agent harness can list
      tools and run a local fetch against your documentation site.
    </p>
  </article>
  <footer>Copyright 2026 Example Corp. All rights reserved. Privacy Terms.</footer>
</body>
</html>`

const TITLE_ONLY_HTML = `<!DOCTYPE html>
<html>
<head><title>Hello World Site</title></head>
<body>
  <div id="content">
    <h1>Hello World Site</h1>
    <p>Hi</p>
  </div>
  <aside>
    Bonus content that full Turndown keeps: UNIQUEFALLBACKMARKER and more
    words for the full page conversion path when Readability is title-only.
  </aside>
</body>
</html>`

const SPA_SHELL_HTML = `<!DOCTYPE html>
<html>
<head><title>Dashboard</title></head>
<body>
  <div id="app"></div>
  <script>window.__BOOT__=true</script>
</body>
</html>`

describe('convertWebContent', () => {
  it('returns text/markdown; charset=utf-8 as-is without extraction', () => {
    const body = '# Native Markdown\n\n<script>alert(1)</script>\n\nKeep fences.'
    const result = convertWebContent({
      body,
      contentType: 'text/markdown; charset=utf-8',
      format: 'markdown',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.kind).toBe('markdown')
    expect(result.text).toBe(body)
    expect(result.text).toContain('<script>')
  })

  it('does not short-circuit text/x-markdown as native markdown', () => {
    const body = '# Not Native\n\nStill plain text unless HTML.'
    const result = convertWebContent({
      body,
      contentType: 'text/x-markdown',
      format: 'markdown',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.kind).toBe('passthrough')
    expect(result.text).toBe(body)
  })

  it('passes application/json through without html conversion', () => {
    const body = '{"ok":true,"html":"<b>nope</b>"}'
    const result = convertWebContent({
      body,
      contentType: 'application/json',
      format: 'markdown',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.kind).toBe('passthrough')
    expect(result.text).toBe(body)
  })

  it('converts HTML to markdown, strips script/style, and drops nav/footer chrome', () => {
    const withScripts = ARTICLE_HTML.replace(
      '</head>',
      `<style>.nav{color:red}</style>
<script>window.TRACK=1</script>
</head>`,
    )
    const result = convertWebContent({
      body: withScripts,
      contentType: 'text/html; charset=utf-8',
      format: 'markdown',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.kind).toBe('markdown')
    expect(result.text).toMatch(/Installing Vixl/)
    expect(result.text).toMatch(/install Vixl/)
    expect(result.text).not.toMatch(/window\.TRACK/)
    expect(result.text).not.toMatch(/\.nav\{color:red\}/)
    expect(result.text).not.toMatch(/Home Docs Pricing Login/)
    expect(result.text).not.toMatch(/Copyright 2026 Example Corp/)
  })

  it('falls back to full Turndown when Readability is empty or title-only', () => {
    const result = convertWebContent({
      body: TITLE_ONLY_HTML,
      contentType: 'text/html',
      format: 'markdown',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      return
    }
    expect(result.kind).toBe('markdown')
    expect(result.text).toContain('UNIQUEFALLBACKMARKER')
    expect(result.text).toMatch(/Bonus content that full Turndown keeps/)
  })

  it('returns a clear error for binary Content-Types', () => {
    const result = convertWebContent({
      body: '%PDF-1.4',
      contentType: 'application/pdf',
      format: 'markdown',
    })
    expect(result.ok).toBe(false)
    if (result.ok) {
      return
    }
    expect(result.error).toMatch(/application\/pdf/)
  })
})

describe('truncateWebText', () => {
  it('truncates with start_index and nextStartIndex', () => {
    const text = 'abcdefghijklmnopqrstuvwxyz'
    const first = truncateWebText({ text, maxLength: 10, startIndex: 0 })
    expect(first).toEqual({
      text: 'abcdefghij',
      truncated: true,
      nextStartIndex: 10,
    })
    const second = truncateWebText({
      text,
      maxLength: 10,
      startIndex: first.nextStartIndex,
    })
    expect(second).toEqual({
      text: 'klmnopqrst',
      truncated: true,
      nextStartIndex: 20,
    })
    const third = truncateWebText({
      text,
      maxLength: 10,
      startIndex: second.nextStartIndex,
    })
    expect(third).toEqual({
      text: 'uvwxyz',
      truncated: false,
    })
  })
})

describe('isSpaShell', () => {
  it('is true for an empty #app shell', () => {
    expect(
      isSpaShell({
        html: SPA_SHELL_HTML,
        text: '',
        title: 'Dashboard',
      }),
    ).toBe(true)

    const converted = convertWebContent({
      body: SPA_SHELL_HTML,
      contentType: 'text/html',
      format: 'markdown',
    })
    expect(converted.ok).toBe(true)
    if (!converted.ok) {
      return
    }
    expect(converted.spaShell).toBe(true)
  })

  it('is false for a real article', () => {
    const converted = convertWebContent({
      body: ARTICLE_HTML,
      contentType: 'text/html',
      format: 'markdown',
    })
    expect(converted.ok).toBe(true)
    if (!converted.ok) {
      return
    }
    expect(converted.spaShell).toBe(false)
    expect(
      isSpaShell({
        html: ARTICLE_HTML,
        text: converted.text,
        title: 'Docs Guide',
      }),
    ).toBe(false)
  })
})
