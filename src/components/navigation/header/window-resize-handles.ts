export type WindowResizeHandleSide = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export type WindowResizeDirection =
  | 'North'
  | 'South'
  | 'East'
  | 'West'
  | 'NorthEast'
  | 'NorthWest'
  | 'SouthEast'
  | 'SouthWest'

export const shouldShowWindowResizeHandles = ({
  isDecorated,
  isMaximized,
}: {
  isDecorated: boolean
  isMaximized: boolean
}): boolean => !isDecorated && !isMaximized

export const WINDOW_RESIZE_HANDLE_DIRECTIONS: Record<
  WindowResizeHandleSide,
  WindowResizeDirection
> = {
  n: 'North',
  s: 'South',
  e: 'East',
  w: 'West',
  ne: 'NorthEast',
  nw: 'NorthWest',
  se: 'SouthEast',
  sw: 'SouthWest',
}
