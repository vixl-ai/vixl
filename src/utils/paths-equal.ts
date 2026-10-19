const normalizePath = (value: string): string =>
  value.replace(/\\/g, '/').replace(/\/+$/, '')

export default (left: string, right: string): boolean =>
  normalizePath(left) === normalizePath(right)
