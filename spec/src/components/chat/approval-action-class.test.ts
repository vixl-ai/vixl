import { describe, expect, it } from 'vitest'
import type { ApprovalActionKey } from '@/components/chat/chat-tool-card'
import approvalActionClass from '@/components/chat/approval-action-class'

const KEYS: ApprovalActionKey[] = [
  'once',
  'session',
  'workspace',
  'always',
  'deny',
  'never',
]

const CHAT_TOKENS: Record<ApprovalActionKey, string[]> = {
  once: [
    'text-emerald-600',
    'hover:text-emerald-500',
    'dark:text-emerald-400',
    'dark:hover:text-emerald-300',
  ],
  session: [
    'text-amber-600',
    'hover:text-amber-500',
    'dark:text-amber-400',
    'dark:hover:text-amber-300',
  ],
  workspace: [
    'text-sky-600',
    'hover:text-sky-500',
    'dark:text-sky-400',
    'dark:hover:text-sky-300',
  ],
  always: [
    'text-violet-600',
    'hover:text-violet-500',
    'dark:text-violet-400',
    'dark:hover:text-violet-300',
  ],
  deny: ['text-destructive', 'hover:text-destructive'],
  never: [
    'text-rose-600',
    'hover:text-rose-500',
    'dark:text-rose-400',
    'dark:hover:text-rose-300',
  ],
}

const TERMINAL_TOKENS: Record<ApprovalActionKey, string[]> = {
  once: ['text-emerald-400', 'hover:bg-zinc-800', 'hover:!text-emerald-300'],
  session: ['text-amber-400', 'hover:bg-zinc-800', 'hover:!text-amber-300'],
  workspace: ['text-sky-400', 'hover:bg-zinc-800', 'hover:!text-sky-300'],
  always: ['text-violet-400', 'hover:bg-zinc-800', 'hover:!text-violet-300'],
  deny: ['text-red-400', 'hover:bg-zinc-800', 'hover:!text-red-300'],
  never: ['text-red-400', 'hover:bg-zinc-800', 'hover:!text-red-300'],
}

describe('approvalActionClass', () => {
  it('prefixes every class with size-7 shrink-0', () => {
    for (const key of KEYS) {
      expect(approvalActionClass(key, 'chat').startsWith('size-7 shrink-0')).toBe(
        true,
      )
      expect(
        approvalActionClass(key, 'terminal').startsWith('size-7 shrink-0'),
      ).toBe(true)
    }
  })

  it('maps each key to chat tone color tokens', () => {
    for (const key of KEYS) {
      const cls = approvalActionClass(key, 'chat')
      for (const token of CHAT_TOKENS[key]) {
        expect(cls).toContain(token)
      }
    }
  })

  it('maps each key to terminal tone color tokens', () => {
    for (const key of KEYS) {
      const cls = approvalActionClass(key, 'terminal')
      for (const token of TERMINAL_TOKENS[key]) {
        expect(cls).toContain(token)
      }
    }
  })
})
