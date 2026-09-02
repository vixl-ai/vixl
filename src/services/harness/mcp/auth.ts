import { UnauthorizedError } from '@ai-sdk/mcp'
import type { McpAuthKind } from '@/services/mcp/mcp-auth-gate'
import isDcrMissingClientError from '@/services/mcp/oauth/is-dcr-missing-client'

export const mcpAuthErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') {
    return error
  }
  return String(error)
}

export const isMcpAuthError = (error: unknown): boolean => {
  if (error instanceof UnauthorizedError) {
    return true
  }
  if (isDcrMissingClientError(error)) {
    return true
  }
  const message = mcpAuthErrorMessage(error).toLowerCase()
  return (
    message.includes('unauthorized') ||
    message.includes('auth_required') ||
    message.includes('401')
  )
}

export const mcpAuthKindForError = (error: unknown): McpAuthKind => {
  const message = mcpAuthErrorMessage(error).toLowerCase()
  if (message.includes('inputs') || message.includes('auth_required:inputs')) {
    return 'inputs'
  }
  if (isDcrMissingClientError(error)) {
    return 'client'
  }
  return 'oauth'
}

export const truncateMcpDescription = (value: string | null | undefined, max = 200): string => {
  const text = (value ?? '').trim()
  if (text.length <= max) {
    return text
  }
  return `${text.slice(0, max)}...`
}
