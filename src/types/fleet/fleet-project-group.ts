export type FleetProjectGroup = {
  id: string
  name: string
  slug: string
  memberSlugs: string[]
  lastOpened: string
}

export type FleetProjectGroupsRegistry = {
  version: 1
  groups: FleetProjectGroup[]
}
