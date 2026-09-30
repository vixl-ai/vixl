export type FeatureAccent = 'purple' | 'blue' | 'green'

export type FeatureSection = {
  id: 'coding' | 'planning' | 'editor' | 'terminals'
  name: string
  accent: FeatureAccent
  description: string
  learnMoreHref: string
  learnMoreLabel: string
  scene: 'coding' | 'planning' | 'editor' | 'terminal'
  altLight: string
  altDark: string
}

export const features: FeatureSection[] = [
  {
    id: 'coding',
    name: 'Coding',
    accent: 'purple',
    description:
      'Agent mode reads your code, edits files, and runs your tools. Every change lands as a diff you can review, and any turn can be rolled back.',
    learnMoreHref: '/concepts/chat-modes',
    learnMoreLabel: 'Learn more about chat modes',
    scene: 'coding',
    altLight:
      'Vixl Agent mode chat in light theme, showing file edits and tool use beside the workbench',
    altDark:
      'Vixl Agent mode chat in dark theme, showing file edits and tool use beside the workbench',
  },
  {
    id: 'planning',
    name: 'Planning',
    accent: 'blue',
    description:
      'Create and implement persisted plans that describe your project over time. Save on cost with native agentic orchestration support.',
    learnMoreHref: '/using/work-with-plans',
    learnMoreLabel: 'Learn more about plans',
    scene: 'planning',
    altLight:
      'Vixl plan tab in light theme with PLAN.md todos and Build and Orchestrate actions',
    altDark:
      'Vixl plan tab in dark theme with PLAN.md todos and Build and Orchestrate actions',
  },
  {
    id: 'editor',
    name: 'Integrated Editor',
    accent: 'green',
    description:
      'A full Monaco editor with LSP support sits next to the chat, so you can read, fix, and review without switching apps.',
    learnMoreHref: '/using/use-the-workbench',
    learnMoreLabel: 'Learn more about the workbench',
    scene: 'editor',
    altLight:
      'Vixl integrated editor in light theme with Monaco, LSP support, file tree, and language server status',
    altDark:
      'Vixl integrated editor in dark theme with Monaco, LSP support, file tree, and language server status',
  },
  {
    id: 'terminals',
    name: 'Terminals',
    accent: 'blue',
    description:
      'Real terminals open in your project root, right beside the conversation.',
    learnMoreHref: '/using/use-the-workbench',
    learnMoreLabel: 'Learn more about terminals',
    scene: 'terminal',
    altLight:
      'Vixl workbench terminal in light theme showing an interactive PTY in the project root',
    altDark:
      'Vixl workbench terminal in dark theme showing an interactive PTY in the project root',
  },
]

export const principles = [
  {
    title: 'No account',
    body: 'No sign-up, no analytics, no Vixl server. Keys stay in your OS keychain.',
  },
  {
    title: 'Any model',
    body: 'Use a provider key you already have, or a local host like Ollama or LM Studio.',
  },
  {
    title: 'Lean context',
    body: 'Progressive tool discovery loads MCP schemas and skills only when the agent asks, so prefills stay small and local models stay fast.',
  },
  {
    title: 'Open source',
    body: 'MIT licensed and free, for macOS, Windows, and Linux.',
  },
] as const

export const releasesUrl = 'https://github.com/vixl-ai/vixl/releases/latest'
export const githubRepo = 'https://github.com/vixl-ai/vixl'
export const licenseUrl = 'https://github.com/vixl-ai/vixl/blob/main/LICENSE'
