import type { GrepMatch } from '@/services/vixl/vixl-tauri'

export type SearchFileGroup = {
  path: string
  hits: GrepMatch[]
  memberSlug?: string
  projectId?: string
  projectRoot?: string
}

export type SearchMemberSection = {
  slug: string
  projectId: string
  truncated: boolean
  groups: SearchFileGroup[]
}
