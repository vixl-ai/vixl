const normalizePath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/\/+$/, '')

const collapsePrivatePrefix = (value: string): string =>
  normalizePath(value).replace(/^\/private(?=\/)/, '')

export const pathsEqualCanonical = (left: string, right: string): boolean =>
  collapsePrivatePrefix(left) === collapsePrivatePrefix(right)

export default (left: string, right: string): boolean =>
  normalizePath(left) === normalizePath(right)
