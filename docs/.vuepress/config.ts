import { viteBundler } from '@vuepress/bundler-vite'
import { markdownChartPlugin } from '@vuepress/plugin-markdown-chart'
import { defaultTheme } from '@vuepress/theme-default'
import { defineUserConfig } from 'vuepress'

export default defineUserConfig({
  base: '/',
  lang: 'en-US',
  title: 'vixl',
  description: 'Local-first BYOK Agents UI',

  bundler: viteBundler(),

  theme: defaultTheme({
    repo: 'vixl-ai/vixl',
    docsDir: 'docs',
    docsBranch: 'main',
    editLink: true,
    lastUpdated: true,
    contributors: false,
    navbar: [],
    sidebar: false,
  }),

  plugins: [
    markdownChartPlugin({
      mermaid: true,
    }),
  ],
})
