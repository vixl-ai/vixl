import type { RouteLocationRaw } from 'vue-router'
import { readFleetGroups } from '@/utils/fleet-group-reader'
import { isGroupSlug } from '@/utils/primary-project-for-slug'

export default (slug: string, section?: string): RouteLocationRaw => ({
  name: (isGroupSlug(slug, readFleetGroups()) ? 'group' : 'project') as 'group' | 'project',
  params: { slug },
  query: section ? { section } : undefined,
})
