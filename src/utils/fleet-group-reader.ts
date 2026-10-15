import type { FleetProjectGroup } from '@/types/fleet/fleet-project-group'

let readGroups: () => FleetProjectGroup[] = () => []

export const setFleetGroupReader = (reader: () => FleetProjectGroup[]): void => {
  readGroups = reader
}

export const readFleetGroups = (): FleetProjectGroup[] => {
  try {
    return readGroups()
  } catch {
    return []
  }
}
