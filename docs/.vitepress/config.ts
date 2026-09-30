import { defineConfig, type HeadConfig } from 'vitepress'
import llmstxt from 'vitepress-plugin-llms'

const githubRepo = 'https://github.com/vixl-ai/vixl'
const siteOrigin = 'https://vixl.app'
const ogImage = `${siteOrigin}/hero.png`

type FaqItem = {
  question: string
  answer: string
}

// Mirrors questions and answers in docs/resources/faq.md.
const faqItems: FaqItem[] = [
  {
    question: 'What does Vixl stand for?',
    answer:
      'Vixl stands for "Vue Pixel", a love of building websites (pixels on a screen) with Vue.',
  },
  {
    question: 'Is Vixl going to keep adding features forever?',
    answer:
      'No. Once the roadmap is met, Vixl gets only optimizations and bug fixes. Paid harnesses bloat because employees working 40-hour weeks need something to do. See Philosophy.',
  },
  {
    question: 'Is there a cloud service?',
    answer:
      'No, never. There is no Vixl account and no Vixl home server. You bring your own keys and hosts. See Privacy.',
  },
  {
    question: 'Where are my keys?',
    answer:
      'In the OS keychain, never in .vixl or settings.json. On Linux without Secret Service, they fall back to secrets-vault.json in the app config dir. See Providers for the key format.',
  },
  {
    question: 'Do I need an account to use a local model?',
    answer:
      'No. Ollama and other local OpenAI-compatible hosts work without a Vixl account and without an API key. Add a provider when you want one. See Set up providers and models.',
  },
  {
    question: 'Where is my data?',
    answer:
      'Personal config is {appData}/.vixl (on macOS, ~/Library/Application Support/app.vixl/.vixl). Project config is <repo>/.vixl. Chats live in vixl.sqlite and under .vixl/chats/. See .vixl layout.',
  },
  {
    question: 'What happens when I delete a chat?',
    answer:
      'The SQLite row and the chat directory are removed. There is no archive and no Vixl-side memory of that thread. If you used a cloud provider, that provider\'s retention is the provider\'s business. See Privacy.',
  },
  {
    question: 'Does Vixl send analytics?',
    answer:
      'No. The only telemetry-related string in the app is CODEGRAPH_TELEMETRY=0, which turns off the CodeGraph package\'s own telemetry. Vixl still makes the network calls listed on Privacy.',
  },
  {
    question: 'What license is Vixl?',
    answer:
      'MIT. The desktop app is free. You pay the model host you configured. There is no Vixl subscription.',
  },
  {
    question: 'How do I install it?',
    answer:
      'Download a build from GitHub Releases (macOS arm64, Linux x64, Windows), or build from source. macOS and Windows installers are unsigned, so Gatekeeper or SmartScreen may prompt on first open. See Installation.',
  },
]

function canonicalUrl(relativePath: string): string {
  const cleaned = relativePath
    .replace(/\\/g, '/')
    .replace(/(^|\/)index\.md$/, '$1')
    .replace(/\.md$/, '')
  return `${siteOrigin}/${cleaned}`
}

function jsonLdScript(data: Record<string, unknown>): HeadConfig {
  return [
    'script',
    { type: 'application/ld+json' },
    JSON.stringify(data).replace(/</g, '\\u003c'),
  ]
}

function homeJsonLd(siteDescription: string): HeadConfig {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        name: 'Vixl',
        description: siteDescription,
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'macOS, Windows, Linux',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        url: siteOrigin,
        sameAs: githubRepo,
        license: `${githubRepo}/blob/main/LICENSE`,
      },
      {
        '@type': 'WebSite',
        name: 'Vixl',
        url: siteOrigin,
      },
    ],
  })
}

function faqJsonLd(): HeadConfig {
  return jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: item.answer,
      },
    })),
  })
}

export default defineConfig({
  title: 'Vixl',
  description: 'Local-first LLMs UI',
  cleanUrls: true,
  lastUpdated: true,
  sitemap: {
    hostname: 'https://vixl.app',
  },
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico', sizes: 'any' }],
    ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
  ],
  transformHead({ pageData, title, description, siteData }) {
    const canonical = canonicalUrl(pageData.relativePath)
    const isHome = pageData.relativePath === 'index.md'
    const ogType = isHome ? 'website' : 'article'
    const head: HeadConfig[] = [
      ['link', { rel: 'canonical', href: canonical }],
      [
        'link',
        {
          rel: 'alternate',
          type: 'text/plain',
          href: `${siteOrigin}/llms.txt`,
          title: 'llms.txt',
        },
      ],
      ['link', { rel: 'help', href: `${siteOrigin}/getting-started/` }],
      ['meta', { property: 'og:title', content: title }],
      ['meta', { property: 'og:description', content: description }],
      ['meta', { property: 'og:url', content: canonical }],
      ['meta', { property: 'og:type', content: ogType }],
      ['meta', { property: 'og:image', content: ogImage }],
      ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
      ['meta', { name: 'twitter:title', content: title }],
      ['meta', { name: 'twitter:description', content: description }],
      ['meta', { name: 'twitter:image', content: ogImage }],
    ]
    if (isHome) {
      head.push(homeJsonLd(siteData.description))
    }
    if (pageData.relativePath === 'resources/faq.md') {
      head.push(faqJsonLd())
    }
    return head
  },
  vite: {
    plugins: [
      llmstxt({
        domain: 'https://vixl.app',
        generateLLMFriendlyDocsForEachPage: true,
        generateLLMsFullTxt: true,
        excludeIndexPage: false,
      }),
    ],
  },
  themeConfig: {
    search: {
      provider: 'local',
    },
    editLink: {
      pattern: `${githubRepo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub',
    },
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Docs', link: '/getting-started/' },
      { text: 'GitHub', link: githubRepo },
      { text: 'Changelog', link: `${githubRepo}/releases` },
    ],
    sidebar: [
      {
        text: 'Get Started',
        items: [
          { text: 'Overview', link: '/getting-started/' },
          { text: 'Philosophy', link: '/getting-started/philosophy' },
          { text: 'Installation', link: '/getting-started/installation' },
          {
            text: 'Set up providers and models',
            link: '/getting-started/set-up-providers-and-models',
          },
          { text: 'Add a project', link: '/getting-started/add-a-project' },
          { text: 'Your first chat', link: '/getting-started/your-first-chat' },
        ],
      },
      {
        text: 'Concepts',
        items: [
          { text: 'How Vixl works', link: '/concepts/' },
          { text: 'Chat modes', link: '/concepts/chat-modes' },
          {
            text: 'Permissions and approvals',
            link: '/concepts/permissions-and-approvals',
          },
          {
            text: 'Projects and home chats',
            link: '/concepts/projects-and-home-chats',
          },
          { text: 'Models and roles', link: '/concepts/models-and-roles' },
          { text: 'Context', link: '/concepts/context' },
          { text: 'Code graphs', link: '/concepts/code-graphs' },
          { text: 'The .vixl directory', link: '/concepts/the-vixl-directory' },
        ],
      },
      {
        text: 'Using Vixl',
        items: [
          { text: 'Manage chats', link: '/using/manage-chats' },
          {
            text: 'Queue and stop messages',
            link: '/using/queue-and-stop-messages',
          },
          {
            text: 'Review and restore changes',
            link: '/using/review-and-restore-changes',
          },
          {
            text: 'Compact and hand off long chats',
            link: '/using/compact-and-hand-off-long-chats',
          },
          { text: 'Export a transcript', link: '/using/export-a-transcript' },
          { text: 'Work with plans', link: '/using/work-with-plans' },
          {
            text: 'Orchestrate sub-agents',
            link: '/using/orchestrate-sub-agents',
          },
          { text: 'Best practices', link: '/using/best-practices' },
          { text: 'Use the workbench', link: '/using/use-the-workbench' },
          {
            text: 'Shortcuts and the command palette',
            link: '/using/shortcuts-and-the-command-palette',
          },
        ],
      },
      {
        text: 'Customize',
        items: [
          { text: 'Providers', link: '/customize/providers' },
          { text: 'Models', link: '/customize/models' },
          { text: 'MCP servers', link: '/customize/mcp-servers' },
          { text: 'Skills', link: '/customize/skills' },
          { text: 'Custom agents', link: '/customize/custom-agents' },
          {
            text: 'Rules and AGENTS.md',
            link: '/customize/rules-and-agents-md',
          },
          { text: 'Language servers', link: '/customize/language-servers' },
          { text: 'Appearance', link: '/customize/appearance' },
          {
            text: 'Permission settings',
            link: '/customize/permission-settings',
          },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'settings.json', link: '/reference/settings-json' },
          { text: 'mcp.json', link: '/reference/mcp-json' },
          {
            text: 'Custom agent frontmatter',
            link: '/reference/custom-agent-frontmatter',
          },
          { text: 'SKILL.md format', link: '/reference/skill-md-format' },
          {
            text: 'Keyboard shortcuts',
            link: '/reference/keyboard-shortcuts',
          },
          { text: 'Chat statuses', link: '/reference/chat-statuses' },
          { text: '.vixl layout', link: '/reference/vixl-layout' },
          {
            text: 'Managed components',
            link: '/reference/managed-components',
          },
        ],
      },
      {
        text: 'Resources',
        items: [
          { text: 'Troubleshooting', link: '/resources/troubleshooting' },
          { text: 'FAQ', link: '/resources/faq' },
          { text: 'Privacy', link: '/resources/privacy' },
          { text: 'Comparison', link: '/resources/comparison' },
          { text: 'Roadmap', link: '/resources/roadmap' },
          { text: 'Brand and press', link: '/resources/brand' },
          { text: 'Changelog', link: `${githubRepo}/releases` },
        ],
      },
    ],
  },
})
