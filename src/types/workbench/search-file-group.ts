import type { GrepMatch } from '@/services/vixl/vixl-tauri'

export type SearchFileGroup = {
  path: string
  hits: GrepMatch[]
}
