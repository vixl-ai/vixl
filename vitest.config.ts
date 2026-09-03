import { fileURLToPath } from 'node:url'
import { mergeConfig, defineConfig, configDefaults } from 'vitest/config'
import viteConfig from './vite.config'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      exclude: [...configDefaults.exclude, 'e2e/**'],
      include: ['spec/src/**/*.{test,spec}.ts', 'spec/eslint-rules/**/*.{test,spec}.ts'],
      root: fileURLToPath(new URL('./', import.meta.url)),
      coverage: {
        provider: 'v8',
        include: [
          'src/services/**',
          'src/utils/**',
          'src/schemas/**',
          'src/composables/**',
        ],
        exclude: [
          'src/components/shadcn/**',
          'src/components/ai-elements/**',
          'src/**/*.vue',
          'src/**/index.ts',
          'src/auto-imports.d.ts',
          'src/components.d.ts',
          'src/types/**',
          'src/interfaces/**',
        ],
        reporter: ['text', 'text-summary', 'lcov', 'json-summary'],
        thresholds: {
          // Ratchet: set to current coverage (floored). Raise as coverage improves.
          lines: 31,
          functions: 26,
          statements: 31,
          branches: 23,
        },
      },
    },
  }),
)
