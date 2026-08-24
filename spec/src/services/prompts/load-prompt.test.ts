import { describe, expect, it } from 'vitest'
import loadPrompt from '@/services/prompts/load-prompt'

describe('load-prompt', () => {
  it('renders base prompt with variable substitution', () => {
    const rendered = loadPrompt('system/base.md', {
      mode: 'agent',
      projectName: 'vixl',
      projectRoot: '/tmp/vixl',
    })

    expect(rendered).toMatchInlineSnapshot(`
      "You are Vixl, an AI coding agent in agent mode.
      Project: vixl (/tmp/vixl)
      The project named in the Project line is the only repo this chat's workspace tools (read_file, edit_file, run_terminal, git, grep, glob, lsp, codebase_*) run against. If the user asks about a different project or repo by name, do not run workspace tools against the bound repo as a substitute. Use ask_user to confirm, or tell the user to open or create a chat in that project. Do not silently switch projects mid-chat.
      No emojis. An emoji costs ~4 tokens; use plain text."
    `)
  })

  it('renders plan-build handoff with path and title', () => {
    const rendered = loadPrompt('handoffs/plan-build.md', {
      planPath: '.vixl/plans/my-plan.md',
      planTitle: 'My plan',
    })

    expect(rendered).toBe(
      'Execute the plan in `.vixl/plans/my-plan.md` (My plan). Read the plan, work through its todos, and implement the changes.',
    )
  })
})
