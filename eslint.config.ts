import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import pluginVitest from '@vitest/eslint-plugin'
import pluginOxlint from 'eslint-plugin-oxlint'
import skipFormatting from 'eslint-config-prettier/flat'

// To allow more languages other than `ts` in `.vue` files, uncomment the following lines:
// import { configureVueProject } from '@vue/eslint-config-typescript'
// configureVueProject({ scriptLangs: ['ts', 'tsx'] })
// More info at https://github.com/vuejs/eslint-config-typescript/#advanced-setup

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{vue,ts,mts,tsx}'],
  },

  globalIgnores([
    '**/dist/**',
    '**/dist-ssr/**',
    '**/coverage/**',
    'src-tauri/target/**',
    'src-tauri/resources/**',
    'src/components/shadcn/**',
    'src/components/ai-elements/**',
    'src/auto-imports.d.ts',
    'src/components.d.ts',
    'docs/.vuepress/.temp/**',
    'docs/.vuepress/.cache/**',
    'docs/.vuepress/dist/**',
  ]),

  ...pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    ...pluginVitest.configs.recommended,
    files: ['spec/src/**/*.test.ts'],
  },

  ...pluginOxlint.buildFromOxlintConfigFile('.oxlintrc.json'),

  skipFormatting,

  // First-party src only. shadcn/ai-elements are already in globalIgnores.
  {
    name: 'app/max-lines',
    files: ['src/**/*.{ts,vue}'],
    rules: {
      'max-lines': ['error', { skipBlankLines: true, skipComments: true, max: 300 }],
    },
  },

  {
    name: 'app/max-lines-allowlist',
    files: [
      // Template-heavy SFC: script logic extracted, template is inherently large
      'src/components/settings/providers/ManageProviderDialog.vue',
      // Script tightly coupled to large template; deferred extraction to avoid unsafe rewrite
      'src/components/settings/sections/McpServersSection.vue',
      // Script tightly coupled to large template; deferred extraction to avoid unsafe rewrite
      'src/components/workbench/tabs/EditorTab.vue',
      // Script tightly coupled to Vue Flow graph builders; deferred extraction to avoid unsafe rewrite
      'src/components/project/codegraph/NeighborhoodExplorer.vue',
      // Script tightly coupled to prompt editor bridge; deferred extraction to avoid unsafe rewrite
      'src/components/chat/ChatPromptInput.vue',
      // Template-heavy toolbar: every ghost icon button wraps a Tooltip with z-60
      'src/components/workbench/tabs/browser/BrowserToolbar.vue',
      // Outside this slice; still over 300
      'src/components/chat/prompt-editor/ChatPromptEditor.vue',
      'src/components/chat/ChatMcpServerPicker.vue',
      'src/components/chat/ChatThreadContent.vue',
      'src/components/chat/ContextUsageBar.vue',
      'src/components/project/sections/ChatsSection.vue',
      'src/components/ai-elements/code-block/vixl-code-theme.ts',
      'src/components/workbench/tabs/PlanTab.vue',
      'src/components/navigation/aside/left/ChatListItem.vue',
      'src/components/workbench/WorkbenchLspStatus.vue',
    ],
    rules: {
      'max-lines': 'off',
    },
  },
)
