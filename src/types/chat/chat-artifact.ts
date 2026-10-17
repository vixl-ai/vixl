export type ChatArtifact = {
  kind: 'plan' | 'file'
  path: string
  id?: string
  label?: string
  startLine?: number
  endLine?: number
}
