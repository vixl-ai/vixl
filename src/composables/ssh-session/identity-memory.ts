import { sshSessionKey } from '@/utils/ssh-project-root'

const storageKey = (user: string, hostname: string, port: number): string =>
  `vixl.sshIdentity.${sshSessionKey(user, hostname.toLowerCase(), port)}`

export const rememberedSshIdentity = (user: string, hostname: string, port: number): string => {
  try {
    return localStorage.getItem(storageKey(user, hostname, port)) ?? ''
  } catch {
    return ''
  }
}

export const rememberSshIdentity = (
  user: string,
  hostname: string,
  port: number,
  identityFile: string,
): void => {
  const key = storageKey(user, hostname, port)
  try {
    if (!identityFile) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, identityFile)
  } catch {
    void 0
  }
}
