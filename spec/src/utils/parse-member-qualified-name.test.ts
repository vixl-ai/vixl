import { describe, expect, it } from 'vitest'
import {
  hasGroupMembers,
  parseMemberQualifiedName,
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
