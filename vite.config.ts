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

export default defineConfig({
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
        'src/components/studio',
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
      // must not trigger a Vite full reload / app reboot.
      ignored: ['**/src-tauri/**', '**/.vixl/**'],
    },
  },
})
