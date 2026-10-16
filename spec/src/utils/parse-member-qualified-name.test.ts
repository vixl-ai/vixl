import { describe, expect, it } from 'vitest'
import {
  hasGroupMembers,
  isLiveMemberRoot,
  membersFromDeclaredSlugs,
  parseMemberQualifiedName,
  parseMemberQualifiedPath,
} from '@/utils/parse-member-qualified-name'

const members = [
  { slug: 'api', name: 'API', rootPath: '/tmp/api' },
  { slug: 'web', name: 'Web', rootPath: '/tmp/web' },
]

describe('parseMemberQualifiedName', () => {
  it('returns null when members are absent', () => {
    expect(parseMemberQualifiedName('api:deploy', undefined)).toBeNull()
    expect(hasGroupMembers(undefined)).toBe(false)
  })

  it('returns null for a single member list', () => {
    expect(parseMemberQualifiedName('api:deploy', [members[0]!])).toBeNull()
    expect(hasGroupMembers([members[0]!])).toBe(false)
  })

  it('treats a trimmed root path as live', () => {
    expect(isLiveMemberRoot('/tmp/api')).toBe(true)
    expect(isLiveMemberRoot('')).toBe(false)
    expect(isLiveMemberRoot('   ')).toBe(false)
  })

  it('splits slug:name when the slug matches a member', () => {
    expect(parseMemberQualifiedName('api:deploy', members)).toEqual({
      member: members[0],
      name: 'deploy',
    })
  })

  it('keeps extra colons in the name', () => {
    expect(parseMemberQualifiedName('web:foo:bar', members)).toEqual({
      member: members[1],
      name: 'foo:bar',
    })
  })
})

describe('membersFromDeclaredSlugs', () => {
  it('keeps a placeholder when a declared group member is missing', () => {
    expect(membersFromDeclaredSlugs(['api', 'web'], [members[0]!])).toEqual([
      members[0],
      { slug: 'web', name: 'web', rootPath: '' },
    ])
  })

  it('drops a missing slug when the group is genuinely single-member', () => {
    expect(membersFromDeclaredSlugs(['web'], [members[0]!])).toEqual([])
    expect(membersFromDeclaredSlugs(['api'], [members[0]!])).toEqual([members[0]])
  })
})

describe('parseMemberQualifiedPath', () => {
  it('returns null when members are absent or singular', () => {
    expect(parseMemberQualifiedPath('web/src/a.ts', undefined)).toBeNull()
    expect(parseMemberQualifiedPath('web/src/a.ts', [members[1]!])).toBeNull()
  })

  it('splits slug/path when the slug matches a member', () => {
    expect(parseMemberQualifiedPath('web/src/a.ts', members)).toEqual({
      member: members[1],
      path: 'src/a.ts',
    })
  })

  it('keeps extra slashes in the remainder', () => {
    expect(parseMemberQualifiedPath('api/src/nested/file.ts', members)).toEqual({
      member: members[0],
      path: 'src/nested/file.ts',
    })
  })

  it('returns null for an unknown slug or an unprefixed path', () => {
    expect(parseMemberQualifiedPath('mobile/src/a.ts', members)).toBeNull()
    expect(parseMemberQualifiedPath('src/a.ts', members)).toBeNull()
    expect(parseMemberQualifiedPath('web/', members)).toBeNull()
  })
})
