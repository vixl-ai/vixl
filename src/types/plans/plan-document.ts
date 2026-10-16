export type PlanTodoItem = {
  id: string
  content: string
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled'
}

export type PlanFrontmatter = {
  id: string
  title: string
  createdAt: string
  mode: 'plan'
  sourceChatId?: string
  sourceChatSlug?: string
  parent?: string
  builtAt?: string
  lastBuildChatId?: string
  lastBuildChatSlug?: string
  lastBuildModel?: string
  todos: PlanTodoItem[]
}

export type ParsedPlan = {
  frontmatter: PlanFrontmatter | null
  body: string
  parseError?: string
}
