import { isSshProjectRoot } from '@/utils/ssh-project-root'
import { annotateRunsAt } from '@/services/harness/ssh/location'
import { mapSshDenied, mapSshToolError } from '@/services/harness/ssh/map-error'
import { isSensitivePath } from '@/services/harness/permission/policy'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const extrasFromInput = (
  name: string,
  input: unknown,
): {
  path?: string
  command?: string
  toolName: string
  serverId?: string
  installState?: string
} => {
  const path =
    isPlainObject(input) && typeof input.path === 'string'
      ? input.path
      : isPlainObject(input) && typeof input.from === 'string'
        ? input.from
        : isPlainObject(input) && typeof input.planPath === 'string'
          ? input.planPath
          : undefined
  const command =
    isPlainObject(input) && typeof input.command === 'string'
      ? input.command
      : undefined
  const serverId =
    isPlainObject(input) && typeof input.serverId === 'string'
      ? input.serverId
      : undefined
  return { path, command, toolName: name, serverId }
}

const mapResultError = (
  projectRoot: string,
  name: string,
  result: Record<string, unknown>,
  input: unknown,
): Record<string, unknown> => {
  if (typeof result.error !== 'string') {
    return result
  }
  const extras = {
    ...extrasFromInput(name, input),
    installState:
      typeof result.installState === 'string' ? result.installState : undefined,
  }
  if (result.rejected === true) {
    const path = extras.path ?? ''
    const sensitive = sshAllowSensitive(path) || /sensitive path/i.test(result.error)
    return {
      ...result,
      error: mapSshDenied(projectRoot, result.error.replace(/\.$/, ''), { sensitive }),
    }
  }
  const mapped = mapSshToolError(projectRoot, result.error, extras)
  if (mapped === result.error) {
    return result
  }
  return { ...result, error: mapped }
}

export const wrapSshHarnessTools = <T extends Record<string, unknown>>(
  projectRoot: string,
  tools: T,
): T => {
  if (!isSshProjectRoot(projectRoot)) {
    return tools
  }
  const wrapped: Record<string, unknown> = {}
  for (const [name, toolDef] of Object.entries(tools)) {
    if (!isPlainObject(toolDef) || typeof toolDef.execute !== 'function') {
      wrapped[name] = toolDef
      continue
    }
    const execute = toolDef.execute as (...args: never[]) => unknown | Promise<unknown>
    wrapped[name] = {
      ...toolDef,
      execute: async (...args: never[]) => {
        try {
          const result = await execute(...args)
          const located = annotateRunsAt(projectRoot, name, result)
          if (isPlainObject(located)) {
            return mapResultError(projectRoot, name, located, args[0])
          }
          return located
        } catch (error) {
          throw new Error(
            mapSshToolError(projectRoot, error, {
              ...extrasFromInput(name, args[0]),
              fromThrow: true,
            }),
          )
        }
      },
    }
  }
  return wrapped as T
}

export const sshAllowSensitive = (path: string): boolean => isSensitivePath(path)
