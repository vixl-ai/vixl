import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Icon-pack boundary enforcement (repository test).
 *
 * Application source must not import the icon pack packages directly; only
 * `src/icons/adapters/**` may. This complements the ESLint rule, which cannot
 * see directories excluded from linting (shadcn/ai-elements vendored code).
 */

const RESTRICTED = ['@lucide/vue', '@tabler/icons-vue', '@phosphor-icons/vue']

const SRC_ROOT = join(__dirname, '../../../src')
const ALLOWED_PREFIXES = [join(SRC_ROOT, 'icons/adapters')]

const collectFiles = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full))
      continue
    }
    if (/\.(ts|vue)$/.test(full)) {
      out.push(full)
    }
  }
  return out
}

const isAllowed = (file: string): boolean =>
  ALLOWED_PREFIXES.some((prefix) => file.startsWith(prefix))

const importPattern = new RegExp(
  `from\\s+['"](${RESTRICTED.map((r) => r.replace('/', '\\/')).join('|')})(\\/.*)?['"]`,
)

describe('icon pack import boundary', () => {
  it('only allows pack imports inside src/icons/adapters', () => {
    const offenders: string[] = []
    for (const file of collectFiles(SRC_ROOT)) {
      if (isAllowed(file)) {
        continue
      }
      if (importPattern.test(readFileSync(file, 'utf8'))) {
        offenders.push(file)
      }
    }
    expect(offenders, `direct pack imports found in:\n${offenders.join('\n')}`).toEqual([])
  })

  it('adapters use explicit named imports (no namespace imports)', () => {
    for (const file of collectFiles(join(SRC_ROOT, 'icons/adapters'))) {
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/import\s+\*\s+as\s+\w+\s+from\s+['"]@/)
    }
  })
})
