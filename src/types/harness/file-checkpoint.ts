export type FileCheckpointBaseline = {
  path: string
  pathHash: string
  existed: boolean
  capturedAt: string
  toolCallId?: string
}

export type FileCheckpointCaptureResult = {
  captured: FileCheckpointBaseline[]
  skippedOversize: string[]
}

export type FileCheckpointRestoreTarget = {
  path: string
  userMessageId: string
  key?: string
}

export type FileCheckpointPathResult = {
  path: string
  status: 'restored' | 'deleted' | 'skipped' | 'error'
  error?: string
}

export type FileCheckpointRestoreResult = {
  restored: string[]
  deleted: string[]
  skipped: string[]
  errors: Array<{ path: string; error: string }>
}

export type FileCheckpointFilePolicy = 'keep' | 'revert'

export type AggregatedTurnFileChange = {
  path: string
  operation: 'create' | 'update' | 'delete' | 'rename'
  additions: number
  deletions: number
  renameTo?: string
}
