import { describe, expect, it } from 'vitest'
import commandNeedsSandboxNetwork from '@/services/harness/shell/command-needs-network'

describe('commandNeedsSandboxNetwork', () => {
  it('detects npm audit and compound npm commands', () => {
    expect(commandNeedsSandboxNetwork('npm audit')).toBe(true)
    expect(
      commandNeedsSandboxNetwork('npm outdated; echo "---"; npm audit'),
    ).toBe(true)
  })

  it('detects other package managers as commands', () => {
    expect(commandNeedsSandboxNetwork('npx prettier')).toBe(true)
    expect(commandNeedsSandboxNetwork('pnpm install')).toBe(true)
    expect(commandNeedsSandboxNetwork('yarn add lodash')).toBe(true)
    expect(commandNeedsSandboxNetwork('bun install')).toBe(true)
    expect(commandNeedsSandboxNetwork('pip install flask')).toBe(true)
    expect(commandNeedsSandboxNetwork('pip3 install flask')).toBe(true)
    expect(commandNeedsSandboxNetwork('cargo build')).toBe(true)
  })

  it('detects curl wget and gh', () => {
    expect(commandNeedsSandboxNetwork('curl')).toBe(true)
    expect(commandNeedsSandboxNetwork('wget -q -O- example.com')).toBe(true)
    expect(commandNeedsSandboxNetwork('gh pr list')).toBe(true)
  })

  it('detects git network subcommands', () => {
    expect(commandNeedsSandboxNetwork('git push')).toBe(true)
    expect(commandNeedsSandboxNetwork('git fetch')).toBe(true)
    expect(commandNeedsSandboxNetwork('git pull')).toBe(true)
    expect(commandNeedsSandboxNetwork('git clone')).toBe(true)
    expect(commandNeedsSandboxNetwork('git ls-remote')).toBe(true)
  })

  it('does not treat local git or listing as network', () => {
    expect(commandNeedsSandboxNetwork('git status')).toBe(false)
    expect(commandNeedsSandboxNetwork('ls')).toBe(false)
  })

  it('detects http and https literals', () => {
    expect(
      commandNeedsSandboxNetwork('python -c "print(\'https://example.com\')"'),
    ).toBe(true)
  })

  it('does not match commands inside unrelated words', () => {
    expect(commandNeedsSandboxNetwork('echo npmrc')).toBe(false)
    expect(commandNeedsSandboxNetwork('cat company.txt')).toBe(false)
  })
})
