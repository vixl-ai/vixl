import type { HarnessToolContext } from '@/types/harness/tool-context'
import type { HarnessWorkspace } from '@/types/harness/harness-workspace'

const bindLiveToolContext = (
  workspace: HarnessWorkspace,
  rest: Omit<HarnessToolContext, 'projectRoot' | 'projectSlug' | 'members'>,
): HarnessToolContext => ({
  ...rest,
  get projectRoot() {
    return workspace.projectRoot
  },
  set projectRoot(value: string) {
    workspace.projectRoot = value
  },
  get projectSlug() {
    return workspace.projectSlug
  },
  set projectSlug(value: string) {
    workspace.projectSlug = value
  },
  get members() {
    return workspace.members
  },
  set members(value: HarnessWorkspace['members']) {
    workspace.members = value
  },
})

export default bindLiveToolContext
