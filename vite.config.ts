import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'

// https://vite.dev/config/
// Object form (not a callback) so vitest mergeConfig can load this file.
const enableVueDevTools =
  process.env.NODE_ENV !== 'production' && process.env.VITEST !== 'true'

const tauriConfPath = fileURLToPath(new URL('./src-tauri/tauri.conf.json', import.meta.url))
const tauriConf = JSON.parse(readFileSync(tauriConfPath, 'utf-8')) as { version: string }
const appVersion = tauriConf.version

let gitSha = 'unknown'
try {
  gitSha = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
} catch {
  gitSha = 'unknown'
}

export default defineConfig({
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(gitSha),
  },
  plugins: [
    AutoImport({
      imports: ['vue', '@vueuse/core'],
      dirs: ['src/composables'],
      dts: 'src/auto-imports.d.ts',
      dtsMode: 'overwrite',
      vueTemplate: true,
      eslintrc: {
        enabled: true,
        filepath: './.eslintrc-auto-import.json',
      },
    }),
    Components({
      dirs: [
        'src/components/ai-elements',
        'src/components/chat',
        'src/components/mcp',
        'src/components/models',
        'src/components/navigation',
        'src/components/project',
        'src/components/settings',
        'src/components/terminal',
        'src/components/workbench',
      ],
      dts: 'src/components.d.ts',
    }),
    vue(),
    ...(enableVueDevTools ? [vueDevTools()] : []),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/vscode-material-icons/generated/icons/*.svg',
          dest: 'file-icons',
          rename: { stripBase: true },
        },
      ],
    }),
  ],
  resolve: {
    alias: [
      {
        find: '@/components/ui',
        replacement: fileURLToPath(new URL('./src/components/shadcn/ui', import.meta.url)),
      },
      {
        find: '@',
        replacement: fileURLToPath(new URL('./src', import.meta.url)),
      },
    ],
  },
  // https://v2.tauri.app/start/create-project/#manual-setup-tauri-cli
  server: {
    watch: {
      // Project `.vixl/` is runtime config (mcp.json, settings); writing it
      // must not trigger a Vite full reload / app reboot. `docs/` is a
      // separate VuePress build, not part of the app bundle.
      ignored: ['**/src-tauri/**', '**/.vixl/**', '**/docs/**'],
    },
  },
})
