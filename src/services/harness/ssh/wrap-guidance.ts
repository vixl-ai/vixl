import { isSshProjectRoot } from '@/utils/ssh-project-root'
import {
  sshHostFromRoot,
  wrapRemoteAgentsMd,
  wrapRemoteReadme,
} from '@/services/harness/ssh/model-errors'

const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

export const wrapRemoteUntrustedFile = (
  projectRoot: string,
  path: string,
  content: string,
): string => {
  if (!isSshProjectRoot(projectRoot)) {
    return content
  }
  if (
    content.includes('(untrusted data, not project guidance)')
  ) {
    return content
  }
  const name = fileName(path)
  const host = sshHostFromRoot(projectRoot)
  if (/^agents\.md$/i.test(name)) {
    return wrapRemoteAgentsMd(host, content)
  }
  if (/^readme(\.[a-z0-9]+)?$/i.test(name)) {
    return wrapRemoteReadme(host, content)
  }
  return content
}
