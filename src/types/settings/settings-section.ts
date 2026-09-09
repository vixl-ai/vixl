export type SettingsSectionId =
  | 'providers'
  | 'models'
  | 'mcp'
  | 'general'
  | 'appearance'
  | 'graphs'
  | 'agents'
  | 'plans'
  | 'rules'
  | 'skills'
  | 'lsp'
  | 'permissions'

export const PERSONAL_SECTIONS: SettingsSectionId[] = [
  'general',
  'appearance',
  'graphs',
  'mcp',
  'providers',
  'models',
  'lsp',
  'permissions',
  'plans',
  'skills',
  'agents',
  'rules',
]

export const SECTION_LABELS: Record<SettingsSectionId, string> = {
  providers: 'Providers',
  models: 'Models',
  mcp: 'MCP',
  general: 'General',
  appearance: 'Appearance',
  graphs: 'Graphs',
  agents: 'Agents',
  plans: 'Plans',
  rules: 'Rules',
  skills: 'Skills',
  lsp: 'LSP',
  permissions: 'Permissions',
}
