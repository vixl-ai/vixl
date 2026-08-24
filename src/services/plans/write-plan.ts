import slugify from 'slugify'
import { planFrontmatterSchema, parsedPlanSchema, formatPlanSchemaError } from '@/schemas/plan-document'
import parsePlan from '@/services/plans/parse-plan'
import type { PlanTodoItem } from '@/types/plans/plan-document'

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

const formatTimestamp = (date: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
}

const formatTodos = (todos: PlanTodoItem[]): string => {
  if (todos.length === 0) {
    return 'todos: []'
  }
  const lines = ['todos:']
  for (const todo of todos) {
    lines.push(`  - id: ${todo.id}`)
    lines.push(`    content: ${JSON.stringify(todo.content)}`)
    lines.push(`    status: ${todo.status}`)
  }
  return lines.join('\n')
}

export type CreatePlanInput = {
  title: string
  body: string
  todos?: PlanTodoItem[]
  sourceChatId?: string
}

export type CreatePlanResult = {
  planId: string
  path: string
  content: string
}

const validatePlanDocument = (frontmatter: unknown, body: string): void => {
  const frontmatterResult = planFrontmatterSchema.safeParse(frontmatter)
  if (!frontmatterResult.success) {
    throw new Error(`Invalid plan frontmatter: ${formatPlanSchemaError(frontmatterResult.error)}`)
  }

  const parsedResult = parsedPlanSchema.safeParse({
    frontmatter: frontmatterResult.data,
    body,
  })
  if (!parsedResult.success) {
    throw new Error(`Invalid plan document: ${formatPlanSchemaError(parsedResult.error)}`)
  }
}

export default (input: CreatePlanInput): CreatePlanResult => {
  const now = new Date()
  const planId = `${slugify(input.title, { lower: true, strict: true }).slice(0, 48) || 'plan'}-${formatTimestamp(now)}`
  const path = `.vixl/plans/${planId}/PLAN.md`
  const todos = input.todos ?? []
  const body = input.body.trim()
  const frontmatter = {
    id: planId,
    title: input.title,
    createdAt: now.toISOString(),
    mode: 'plan' as const,
    ...(input.sourceChatId ? { sourceChatId: input.sourceChatId } : {}),
    todos,
  }

  validatePlanDocument(frontmatter, body)

  const sourceChatLine = input.sourceChatId ? `sourceChatId: ${input.sourceChatId}\n` : ''
  const content = `---
id: ${planId}
title: ${JSON.stringify(input.title)}
createdAt: ${now.toISOString()}
mode: plan
${sourceChatLine}${formatTodos(todos)}
---

${body}
`

  return { planId, path, content }
}

const removeTodosBlock = (yaml: string): string => {
  const lines = yaml.split('\n')
  const kept: string[] = []
  let skippingTodos = false
  for (const line of lines) {
    if (!skippingTodos && line.trim().startsWith('todos:')) {
      skippingTodos = true
      continue
    }
    if (skippingTodos) {
      if (line.startsWith('  ') || line.startsWith('\t')) {
        continue
      }
      skippingTodos = false
    }
    kept.push(line)
  }
  return kept.join('\n')
}

export const updatePlanTodos = (
  existingContent: string,
  todos: PlanTodoItem[],
): string => {
  const frontmatterMatch = existingContent.match(FRONTMATTER_RE)
  if (!frontmatterMatch) {
    return existingContent
  }

  const yaml = frontmatterMatch[1] ?? ''
  const body = frontmatterMatch[2] ?? ''
  const trimmedYaml = removeTodosBlock(yaml).trimEnd()
  const nextYaml = `${trimmedYaml}\n${formatTodos(todos)}`
  const nextContent = `---\n${nextYaml}\n---\n\n${body.trimStart()}`
  const parsed = parsePlan(nextContent)
  if (parsed.parseError) {
    throw new Error(parsed.parseError)
  }

  return nextContent
}
