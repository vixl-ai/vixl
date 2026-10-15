export type ChatPromptWorkspace =
  | { kind: 'home' }
  | { kind: 'project'; projectId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'projects'; projectIds: string[] }
