import { gateToolPermission } from '@/services/harness/permission/gate'
import toPermCtx from '@/services/harness/shared/to-perm-ctx'
import type { HarnessToolContext } from '@/types/harness/tool-context'

// A sandbox spawn failure or runtime block may fall back to an unsandboxed run
// only after an explicit shell.unsandboxed approval. This keeps the escalation
// behind the same permission gate as a directly requested unsandboxed shell.
const gateUnsandboxedRetry = (
  ctx: HarnessToolContext,
  toolCallId: string,
  title: string,
  command: string,
): Promise<boolean> =>
  gateToolPermission({
    ctx: toPermCtx(ctx),
    toolCallId,
    name: 'run_terminal',
    kind: 'shell',
    action: 'shell.unsandboxed',
    capability: 'shell.unsandboxed',
    title,
    detail: command,
    unsandboxed: true,
  })

export default gateUnsandboxedRetry