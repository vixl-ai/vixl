'use strict'

const path = require('path')

const projectRaw = process.env.VIXL_CODEGRAPH_PROJECT
const storeRaw = process.env.VIXL_CODEGRAPH_STORE

if (!projectRaw || !storeRaw) {
  module.exports = {}
} else {
  const origJoin = path.join
  const origResolve = path.resolve
  const origNormalize = path.normalize
  const origPosixJoin = path.posix.join
  const origPosixResolve = path.posix.resolve
  const origPosixNormalize = path.posix.normalize
  const origWin32Join = path.win32.join
  const origWin32Resolve = path.win32.resolve
  const origWin32Normalize = path.win32.normalize

  const sepRe = /[\\/]+/g

  const norm = (value) => String(value).replace(sepRe, '/')

  const trimSlash = (value) => norm(value).replace(/\/+$/, '')

  const prefix = trimSlash(projectRaw) + '/.codegraph'
  const storeN = trimSlash(storeRaw)

  const rewrite = (result) => {
    const n = norm(result)
    if (n === prefix || n.startsWith(prefix + '/')) {
      const next = storeN + n.slice(prefix.length)
      if (String(result).includes('\\') && !String(result).includes('/')) {
        return next.replace(/\//g, '\\')
      }
      return next
    }
    return result
  }

  path.join = function joinPatched() {
    return rewrite(origJoin.apply(path, arguments))
  }
  path.resolve = function resolvePatched() {
    return rewrite(origResolve.apply(path, arguments))
  }
  path.normalize = function normalizePatched(value) {
    return rewrite(origNormalize.call(path, value))
  }

  path.posix.join = function posixJoinPatched() {
    return rewrite(origPosixJoin.apply(path.posix, arguments))
  }
  path.posix.resolve = function posixResolvePatched() {
    return rewrite(origPosixResolve.apply(path.posix, arguments))
  }
  path.posix.normalize = function posixNormalizePatched(value) {
    return rewrite(origPosixNormalize.call(path.posix, value))
  }

  path.win32.join = function win32JoinPatched() {
    return rewrite(origWin32Join.apply(path.win32, arguments))
  }
  path.win32.resolve = function win32ResolvePatched() {
    return rewrite(origWin32Resolve.apply(path.win32, arguments))
  }
  path.win32.normalize = function win32NormalizePatched(value) {
    return rewrite(origWin32Normalize.call(path.win32, value))
  }

  module.exports = {}
}
