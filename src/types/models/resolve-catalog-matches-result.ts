import type { CatalogMatch } from '@/types/models/catalog-match'

export type ResolveCatalogMatchesOptions = {
  query: string
}

export type ResolveCatalogMatchesOk = {
  matches: CatalogMatch[]
  best?: string
  note?: string
}

export type ResolveCatalogMatchesError = {
  matches: []
  error: string
}

export type ResolveCatalogMatchesResult = ResolveCatalogMatchesOk | ResolveCatalogMatchesError
