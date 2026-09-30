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
    expect(rendered).toContain('Workspace tools are scoped to this repo.')
    expect(rendered).toContain(
      'For work in another project, move this chat there with move_workspace when available, or suggest the user open a chat in that project.',
    )
  })

  it('renders plan-build handoff with path and title', () => {
    const rendered = loadPrompt('handoffs/plan-build.md', {
      planPath: '.vixl/plans/my-plan.md',
      planTitle: 'My plan',
    })

    expect(rendered).toBe(
      'Work through the plan in .vixl/plans/my-plan.md (My plan) until its todos are complete.',
    )
  })

  it('renders compact checkpoint with skill and plan-todo guidance', () => {
    const rendered = loadPrompt('system/compact.md', {
      focus: 'parent',
    })

    expect(rendered).toContain('Skills loaded')
    expect(rendered).toContain('Plan and todos')
    expect(rendered).toContain('names already loaded')
    expect(rendered).toContain('path if any')
    expect(rendered).toContain('todos grouped done, in progress, pending')
    expect(rendered).toContain('output only the checkpoint')
    expect(rendered).toContain('Focus: parent')
    expect(rendered).not.toContain('{{focus}}')
  })

  it('renders plan-orchestrate handoff with locked subagent model', () => {
    const rendered = loadPrompt('handoffs/plan-orchestrate.md', {
      planPath: '.vixl/plans/my-plan.md',
      planTitle: 'My plan',
      subagentModel: 'anthropic::claude-sonnet-4',
    })

    expect(rendered).toContain('Orchestrate the plan in .vixl/plans/my-plan.md (My plan).')
    expect(rendered).toContain(
      "Subagents run on anthropic::claude-sonnet-4, locked by the harness to the user's choice, so spawn_subagent takes no model argument.",
    )
    expect(rendered).toContain(
      'When an early todo creates a worktree or folder, create it first, then call move_workspace, then spawn implementers.',
    )
    expect(rendered).toContain(
      'After spawning, leave a one-line visible status: what was spawned, what is still running, what happens next.',
    )
    expect(rendered).toContain(
      'Then end the turn; the harness resumes as each background subagent finishes.',
    )
    expect(rendered).toContain("terminal_output reads only the parent's own shell_id values.")
    expect(rendered).toContain(
      'On each result, review it, set todo status with update_plan_todo, and continue.',
    )
    expect(rendered).toContain('Revise the plan body with update_plan if scope changes.')
    expect(rendered).toContain('All implementation goes to subagents; the parent edits no files.')
    expect(rendered).not.toContain('{{subagentModel}}')
    expect(rendered).not.toContain('{{planPath}}')
    expect(rendered).not.toContain('{{planTitle}}')
  })
})
