import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'

export type ResolvedMemberPath = {
  memberSlug: string
  root: string
  relativePath: string
}

type PathComponent =
  | { kind: 'root' }
  | { kind: 'prefix'; value: string }
  | { kind: 'cur' }
  | { kind: 'parent' }
  | { kind: 'normal'; value: string }

const isAbsolutePath = (value: string): boolean => {
  if (value.startsWith('/') || value.startsWith('\\')) {
    return true
  }
  return /^[A-Za-z]:[/\\]/.test(value)
}

const parseComponents = (input: string): PathComponent[] => {
  const components: PathComponent[] = []
  let rest = input

  const driveMatch = rest.match(/^([A-Za-z]:)([/\\])/)
  if (driveMatch) {
    components.push({ kind: 'prefix', value: driveMatch[1]! })
    components.push({ kind: 'root' })
    rest = rest.slice(driveMatch[0].length)
  } else if (rest.startsWith('/') || rest.startsWith('\\')) {
    components.push({ kind: 'root' })
    rest = rest.replace(/^[/\\]+/, '')
  }

  for (const raw of rest.split(/[/\\]/)) {
    if (raw === '') {
      continue
    }
    if (raw === '.') {
      components.push({ kind: 'cur' })
      continue
    }
    if (raw === '..') {
      components.push({ kind: 'parent' })
      continue
    }
    components.push({ kind: 'normal', value: raw })
  }

  return components
}

const rejectParentDirComponents = (
  components: PathComponent[],
  options?: { allowPrefix?: boolean },
): void => {
  for (const component of components) {
    if (component.kind === 'parent') {
      throw new Error('Path traversal is not allowed')
    }
    if (component.kind === 'prefix' && !options?.allowPrefix) {
      throw new Error('Invalid path component')
    }
  }
}

const formatValidSlugs = (members: HarnessWorkspaceMember[]): string =>
  members.map((member) => member.slug).join(', ')

const firstNormalSegment = (components: PathComponent[]): string | undefined => {
  for (const component of components) {
    if (component.kind === 'cur') {
      continue
    }
    if (component.kind === 'normal') {
      return component.value
    }
    return undefined
  }
  return undefined
}

const remainderAfterFirstNormal = (components: PathComponent[]): PathComponent[] => {
  const rest: PathComponent[] = []
  let seenFirst = false
  for (const component of components) {
    if (component.kind === 'cur') {
      if (seenFirst) {
        rest.push(component)
      }
      continue
    }
    if (component.kind === 'normal') {
      if (seenFirst) {
        rest.push(component)
      } else {
        seenFirst = true
      }
      continue
    }
    if (component.kind === 'parent') {
      rest.push(component)
    }
  }
  return rest
}

const joinRelative = (components: PathComponent[]): string => {
  const parts: string[] = []
  for (const component of components) {
    if (component.kind === 'normal') {
      parts.push(component.value)
    } else if (component.kind === 'cur') {
      parts.push('.')
    } else if (component.kind === 'parent') {
      parts.push('..')
    }
  }
  return parts.join('/')
}

const normalizeRoot = (rootPath: string): string => rootPath.replace(/\\/g, '/').replace(/\/+$/, '')

const relativeToRoot = (rootPath: string, absolutePath: string): string => {
  const root = normalizeRoot(rootPath)
  const file = absolutePath.replace(/\\/g, '/')
  if (file === root) {
    return ''
  }
  const prefix = `${root}/`
  if (file.startsWith(prefix)) {
    return file.slice(prefix.length)
  }
  return file
}

const isUnderRoot = (rootPath: string, absolutePath: string): boolean => {
  const root = normalizeRoot(rootPath)
  const file = absolutePath.replace(/\\/g, '/')
  return file === root || file.startsWith(`${root}/`)
}

const resolveAbsoluteAgainstMembers = (
  members: HarnessWorkspaceMember[],
  userPath: string,
  components: PathComponent[],
): ResolvedMemberPath => {
  rejectParentDirComponents(components, { allowPrefix: true })

  const matches = members.filter(
    (member) => member.rootPath.trim().length > 0 && isUnderRoot(member.rootPath, userPath),
  )
  if (matches.length === 0) {
    throw new Error('Absolute path is outside all project roots')
  }

  matches.sort((left, right) => normalizeRoot(right.rootPath).length - normalizeRoot(left.rootPath).length)
  const member = matches[0]!
  return {
    memberSlug: member.slug,
    root: member.rootPath,
    relativePath: relativeToRoot(member.rootPath, userPath),
  }
}

const joinUnderMember = (
  member: HarnessWorkspaceMember,
  relativeComponents: PathComponent[],
): ResolvedMemberPath => {
  if (!member.rootPath.trim()) {
    throw new Error(`Project ${member.slug} is no longer available`)
  }

  for (const component of relativeComponents) {
    if (component.kind === 'parent') {
      throw new Error('Path traversal is not allowed')
    }
    if (component.kind === 'root' || component.kind === 'prefix') {
      throw new Error('Invalid path component')
    }
  }

  return {
    memberSlug: member.slug,
    root: member.rootPath,
    relativePath: joinRelative(relativeComponents),
  }
}

const resolveMemberPath = (
  members: HarnessWorkspaceMember[],
  userPath: string,
): ResolvedMemberPath => {
  if (members.length === 0) {
    throw new Error('At least one workspace root is required')
  }

  const trimmed = userPath.trim()
  if (trimmed.length === 0) {
    throw new Error('Path is required')
  }

  const components = parseComponents(trimmed)
  if (isAbsolutePath(trimmed)) {
    return resolveAbsoluteAgainstMembers(members, trimmed, components)
  }

  rejectParentDirComponents(components)

  const segment = firstNormalSegment(components)
  if (segment) {
    const member = members.find((entry) => entry.slug === segment)
    if (member) {
      return joinUnderMember(member, remainderAfterFirstNormal(components))
    }
  }

  if (members.length === 1) {
    return joinUnderMember(members[0]!, components)
  }

  throw new Error(
    `Path must be prefixed with a project slug. Valid slugs: ${formatValidSlugs(members)}`,
  )
}

export default resolveMemberPath
