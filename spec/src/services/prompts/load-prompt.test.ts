import { describe, expect, it } from 'vitest'
import loadPrompt from '@/services/prompts/load-prompt'

describe('load-prompt', () => {
  it('renders base prompt with variable substitution', () => {
    const rendered = loadPrompt('system/base.md', {
      projectName: 'vixl',
      projectRoot: '/tmp/vixl',
    })

    expect(rendered).toContain('Project: vixl (/tmp/vixl)')
    expect(rendered).not.toContain('{{projectName}}')
    expect(rendered).not.toContain('{{projectRoot}}')
    expect(rendered).toContain('Workspace tools run only against this repo.')
    expect(rendered).toContain('ask_user')
    expect(rendered).toContain(
      'If the user names a different project, use ask_user or tell them to open a chat in that project.',
    )
  })

  it('renders plan-build handoff with path and title', () => {
    const rendered = loadPrompt('handoffs/plan-build.md', {
      planPath: '.vixl/plans/my-plan.md',
      planTitle: 'My plan',
    })

    expect(rendered).toBe(
      'Start the plan in `.vixl/plans/my-plan.md` (My plan) \n\nComplete its todos',
    )
  })

  it('renders compact checkpoint with skill and plan-todo guidance', () => {
    const rendered = loadPrompt('system/compact.md', {
      focus: 'parent',
    })

    expect(rendered).toContain('Skills loaded')
    expect(rendered).toContain('Plan+todos')
    expect(rendered).toContain('names already loaded')
    expect(rendered).toContain('path if any')
    expect(rendered).toContain('todos done/in progress/pending')
    expect(rendered).toContain('parent')
    expect(rendered).not.toContain('{{focus}}')
  })

  it('renders plan-orchestrate handoff with locked subagent model', () => {
    const rendered = loadPrompt('handoffs/plan-orchestrate.md', {
      planPath: '.vixl/plans/my-plan.md',
      planTitle: 'My plan',
      subagentModel: 'anthropic::claude-sonnet-4',
    })

    expect(rendered).toContain(
      'Orchestrate the plan in `.vixl/plans/my-plan.md` (My plan).',
    )
    expect(rendered).toContain('Use anthropic::claude-sonnet-4 to handle all work.')
    expect(rendered).toContain('Do not pass `model` to spawn_subagent;')
    expect(rendered).toContain(
      'The harness has locked the model to the users selected choice.',
    )
    expect(rendered).toContain(
      'If an early todo creates a worktree or needs a workspace move, sequence that create, then parent `move_workspace`, then implementers;',
    )
    expect(rendered).toContain(
      'After spawning, leave a one-line visible status covering what was spawned, what is still running, and what happens next. Do not poll with `terminal_output`.',
    )
    expect(rendered).toContain(
      'End the turn; the harness resumes as each background subagent finishes.',
    )
    expect(rendered).toContain(
      'Review outputs, update plan todo status with `update_plan_todo`, and continue.',
    )
    expect(rendered).toContain(
      'Todos still go through `update_plan_todo`. Never write code or mutate files directly;',
    )
    expect(rendered).toContain('Delegate all implementation to sub-agents.')
    expect(rendered).not.toContain('{{subagentModel}}')
    expect(rendered).not.toContain('{{planPath}}')
    expect(rendered).not.toContain('{{planTitle}}')
  })
})
