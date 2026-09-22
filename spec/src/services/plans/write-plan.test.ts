import { describe, expect, it } from 'vitest'
import createPlan, {
  mergePlanTodos,
  updatePlanBody,
  updatePlanTodos,
} from '@/services/plans/write-plan'
import parsePlan from '@/services/plans/parse-plan'

describe('mergePlanTodos', () => {
  it('updates matching ids in place, appends new ids, and keeps unmentioned todos', () => {
    const existing = [
      { id: 'keep', content: 'Keep me', status: 'in_progress' as const },
      { id: 'update', content: 'Old text', status: 'pending' as const },
    ]
    const incoming = [
      { id: 'update', content: 'New text', status: 'completed' as const },
      { id: 'append', content: 'New todo', status: 'pending' as const },
    ]

    expect(mergePlanTodos(existing, incoming)).toEqual([
      { id: 'keep', content: 'Keep me', status: 'in_progress' },
      { id: 'update', content: 'New text', status: 'completed' },
      { id: 'append', content: 'New todo', status: 'pending' },
    ])
  })
})

describe('updatePlanTodos', () => {
  it('replaces the full todos block without leaving orphaned YAML children', () => {
    const created = createPlan({
      title: 'Orphan check',
      body: '## Goal\n\n```mermaid\nflowchart LR\n  a[A] --> b[B]\n```\n',
      todos: [
        { id: 'first', content: 'Old first', status: 'pending' },
        { id: 'second', content: 'Old second', status: 'in_progress' },
      ],
    })

    const next = updatePlanTodos(created.content, [
      { id: 'only', content: 'Replacement todo', status: 'completed' },
    ])

    expect(next).not.toContain('Old first')
    expect(next).not.toContain('Old second')
    expect(next).not.toContain('id: first')
    expect(next).not.toContain('id: second')

    const parsed = parsePlan(next)
    expect(parsed.parseError).toBeUndefined()
    expect(parsed.frontmatter?.todos).toEqual([
      { id: 'only', content: 'Replacement todo', status: 'completed' },
    ])
  })
})

describe('updatePlanBody', () => {
  const created = createPlan({
    title: 'Body swap',
    body: '## Goal\n\nShip it.\n',
    todos: [
      { id: 'keep', content: 'Keep me', status: 'in_progress' },
      { id: 'queued', content: 'Still pending', status: 'pending' },
    ],
  })

  it('replaces the body and preserves frontmatter and todos', () => {
    const original = parsePlan(created.content)
    const next = updatePlanBody(created.content, {
      body: '## Summary\n\nRevised body.\n',
    })

    const parsed = parsePlan(next)
    expect(parsed.parseError).toBeUndefined()
    expect(parsed.body).toBe('## Summary\n\nRevised body.')
    expect(parsed.frontmatter?.id).toBe(original.frontmatter?.id)
    expect(parsed.frontmatter?.title).toBe('Body swap')
    expect(parsed.frontmatter?.createdAt).toBe(original.frontmatter?.createdAt)
    expect(parsed.frontmatter?.mode).toBe('plan')
    expect(parsed.frontmatter?.todos).toEqual(original.frontmatter?.todos)
  })

  it('updates the frontmatter title when provided', () => {
    const original = parsePlan(created.content)
    const next = updatePlanBody(created.content, {
      body: '## Summary\n\nRevised body.\n',
      title: 'Revised title',
    })

    const parsed = parsePlan(next)
    expect(parsed.parseError).toBeUndefined()
    expect(parsed.frontmatter?.title).toBe('Revised title')
    expect(parsed.frontmatter?.id).toBe(original.frontmatter?.id)
    expect(parsed.frontmatter?.todos).toEqual(original.frontmatter?.todos)
    expect(parsed.body).toBe('## Summary\n\nRevised body.')
  })

  it('keeps the existing title when title is omitted', () => {
    const next = updatePlanBody(created.content, {
      body: '## Summary\n\nRevised body.\n',
    })

    const parsed = parsePlan(next)
    expect(parsed.frontmatter?.title).toBe('Body swap')
  })

  it('throws when YAML frontmatter is missing', () => {
    expect(() =>
      updatePlanBody('## Goal\n\nNo frontmatter.\n', {
        body: '## Summary\n\nRevised body.\n',
      }),
    ).toThrow('Plan file is missing YAML frontmatter (expected --- delimiters).')
  })

  it('throws when the reconstructed document fails validation', () => {
    const invalid = `---
id: broken
title: "Broken"
createdAt: not-a-datetime
mode: plan
todos: []
---

Old body
`
    expect(() =>
      updatePlanBody(invalid, { body: '## Summary\n\nRevised body.\n' }),
    ).toThrow(/Invalid plan frontmatter/)
  })
})
