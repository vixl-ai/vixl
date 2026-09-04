import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { viteBundler } from '@vuepress/bundler-vite'
import { markdownChartPlugin } from '@vuepress/plugin-markdown-chart'
import { defaultTheme } from '@vuepress/theme-default'
import { defineUserConfig } from 'vuepress'

const vuepressDir = dirname(fileURLToPath(import.meta.url))

export default defineUserConfig({
  base: '/',
  lang: 'en-US',
  title: 'vixl',
  description: 'Local-first BYOK Agents UI',
  head: [
    ['link', { rel: 'icon', href: '/favicon.ico', sizes: 'any' }],
    ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    ['link', { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' }],
  ],

  alias: {
    '@docs': vuepressDir,
  },

  bundler: viteBundler({
    viteOptions: {
      plugins: [tailwindcss()],
      resolve: {
        alias: {
          '@docs': resolve(vuepressDir),
        },
      },
    },
  }),

  theme: defaultTheme({
    repo: 'vixl-ai/vixl',
    docsDir: 'docs',
    docsBranch: 'main',
    editLink: true,
    lastUpdated: true,
    contributors: false,
    navbar: [
      {
        text: 'Home',
        link: '/',
      },
      {
        text: 'Docs',
        link: '/guide/',
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guide',
          children: ['/guide/'],
        },
      ],
    },
  }),

  plugins: [
    markdownChartPlugin({
      mermaid: true,
    }),
  ],
})
