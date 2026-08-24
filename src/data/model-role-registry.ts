import type { SideTaskKind } from '@/types/harness/side-task-kind'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'

export type ModelRoleGroup = 'general' | 'chatModes' | 'nested' | 'backgroundTasks'

export type ModelRoleId =
  | 'default'
  | VixlChatMode
  | 'subagent'
  | 'title'
  | 'compaction'

export type ModelRoleDefinition = {
  id: ModelRoleId
  settingsKey: `models.${string}`
  reasoningSettingsKey: `models.${string}`
  label: string
  description: string
  group: ModelRoleGroup
  recommendCheapModel?: boolean
  sideTaskKind?: SideTaskKind
}

export const MODEL_ROLE_GROUP_LABELS: Record<ModelRoleGroup, string> = {
  general: 'General',
  chatModes: 'Chat modes',
  nested: 'Nested',
  backgroundTasks: 'Background tasks',
}

export const MODEL_ROLE_REGISTRY: ModelRoleDefinition[] = [
  {
    id: 'default',
    settingsKey: 'models.default',
    reasoningSettingsKey: 'models.defaultReasoning',
    label: 'Default',
    description: 'Fallback for all roles unless a specific override is set.',
    group: 'general',
  },
  {
    id: 'ask',
    settingsKey: 'models.ask',
    reasoningSettingsKey: 'models.askReasoning',
    label: 'Ask',
    description: 'Default model for Ask mode chats.',
    group: 'chatModes',
  },
  {
    id: 'plan',
    settingsKey: 'models.plan',
    reasoningSettingsKey: 'models.planReasoning',
    label: 'Plan',
    description: 'Default model for Plan mode chats.',
    group: 'chatModes',
  },
  {
    id: 'studio',
    settingsKey: 'models.studio',
    reasoningSettingsKey: 'models.studioReasoning',
    label: 'Studio',
    description: 'Default model for Studio mode chats.',
    group: 'chatModes',
  },
  {
    id: 'agent',
    settingsKey: 'models.agent',
    reasoningSettingsKey: 'models.agentReasoning',
    label: 'Agent',
    description: 'Default model for Agent mode chats and single-agent plan execution.',
    group: 'chatModes',
  },
  {
    id: 'orchestrator',
    settingsKey: 'models.orchestrator',
    reasoningSettingsKey: 'models.orchestratorReasoning',
    label: 'Orchestrator',
    description: 'Default model for Orchestrator mode chats and plan orchestration.',
    group: 'chatModes',
  },
  {
    id: 'subagent',
    settingsKey: 'models.subagent',
    reasoningSettingsKey: 'models.subagentReasoning',
    label: 'Subagent',
    description:
      'Default model for nested spawn_subagent runs when an agent file does not set its own model.',
    group: 'nested',
  },
  {
    id: 'title',
    settingsKey: 'models.title',
    reasoningSettingsKey: 'models.titleReasoning',
    label: 'Title',
    description: 'Generates short titles for new chats.',
    group: 'backgroundTasks',
    recommendCheapModel: true,
    sideTaskKind: 'generate-chat-title',
  },
  {
    id: 'compaction',
    settingsKey: 'models.compaction',
    reasoningSettingsKey: 'models.compactionReasoning',
    label: 'Compaction',
    description: 'Summarizes conversation history when context limits are reached.',
    group: 'backgroundTasks',
    recommendCheapModel: true,
  },
]

export const CHAT_MODE_MODEL_ROLES = MODEL_ROLE_REGISTRY.filter(
  (role) => role.group === 'chatModes',
)

export const NESTED_MODEL_ROLES = MODEL_ROLE_REGISTRY.filter(
  (role) => role.group === 'nested',
)

export const BACKGROUND_MODEL_ROLES = MODEL_ROLE_REGISTRY.filter(
  (role) => role.group === 'backgroundTasks',
)
