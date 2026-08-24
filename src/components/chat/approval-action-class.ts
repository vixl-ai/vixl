import type { ApprovalActionKey } from '@/components/chat/chat-tool-card'

const SIZE = 'size-7 shrink-0'

const CHAT: Record<ApprovalActionKey, string> = {
  once: `${SIZE} text-emerald-600 hover:text-emerald-500 dark:text-emerald-400 dark:hover:text-emerald-300`,
  session: `${SIZE} text-amber-600 hover:text-amber-500 dark:text-amber-400 dark:hover:text-amber-300`,
  workspace: `${SIZE} text-sky-600 hover:text-sky-500 dark:text-sky-400 dark:hover:text-sky-300`,
  always: `${SIZE} text-violet-600 hover:text-violet-500 dark:text-violet-400 dark:hover:text-violet-300`,
  deny: `${SIZE} text-destructive hover:text-destructive`,
  never: `${SIZE} text-rose-600 hover:text-rose-500 dark:text-rose-400 dark:hover:text-rose-300`,
}

const TERMINAL: Record<ApprovalActionKey, string> = {
  once: `${SIZE} text-emerald-400 hover:bg-zinc-800 hover:!text-emerald-300`,
  session: `${SIZE} text-amber-400 hover:bg-zinc-800 hover:!text-amber-300`,
  workspace: `${SIZE} text-sky-400 hover:bg-zinc-800 hover:!text-sky-300`,
  always: `${SIZE} text-violet-400 hover:bg-zinc-800 hover:!text-violet-300`,
  deny: `${SIZE} text-red-400 hover:bg-zinc-800 hover:!text-red-300`,
  never: `${SIZE} text-red-400 hover:bg-zinc-800 hover:!text-red-300`,
}

export default (key: ApprovalActionKey, tone: 'chat' | 'terminal'): string =>
  tone === 'terminal' ? TERMINAL[key] : CHAT[key]
