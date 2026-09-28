import { convertToModelMessages, type ModelMessage } from 'ai'
import type { ContinueOrchestratorInput } from '@/types/harness/orchestrator-input'
import createModel from '@/services/providers/create-model'
import { readChatMeta } from '@/services/vixl/vixl-tauri'
import filterMessagesForActiveContext from '@/services/context/filter-messages-for-active-context'
import resolveModelVision from '@/services/harness/resolve-model-vision'
import prepareInterruptedAssistantMessage from '@/utils/prepare-interrupted-assistant-message'
import prepareMessagesForModelVision from '@/utils/prepare-messages-for-model-vision'
import buildContinueNudge from './build-continue-nudge'
import resolveLiveWorkspace from './resolve-workspace'
import runHarnessStream from './stream'

export default async (input: ContinueOrchestratorInput): Promise<void> => {
  const workspace = resolveLiveWorkspace(input)
  const {
    chatId,
    messages,
    assistantId,
    userMessageId,
    ...streamInput
  } = input

  const activeContextMeta = await readChatMeta(workspace.projectSlug, chatId).catch(() => null)
  const activeContext = activeContextMeta?.activeContext
  const { messages: contextMessages, checkpointText } = filterMessagesForActiveContext(
    messages,
    activeContext,
  )
  const visionModel = await createModel({
    providerId: input.providerId,
    modelId: input.modelId,
    settings: input.settings,
  })
  const supportsVision = await resolveModelVision({
    model: visionModel,
    providerId: input.providerId,
    modelId: input.modelId,
    settings: input.settings,
  })
  const recentModelMessages = await convertToModelMessages(
    await prepareMessagesForModelVision(
      prepareInterruptedAssistantMessage(contextMessages),
      supportsVision,
    ),
  )
  const effectiveModelMessages: ModelMessage[] = checkpointText
    ? [
        {
          role: 'user',
          content: checkpointText,
        },
        ...recentModelMessages,
      ]
    : recentModelMessages
  const modelMessages: ModelMessage[] = [
    ...effectiveModelMessages,
    {
      role: 'user',
      content: buildContinueNudge(),
    },
  ]

  await runHarnessStream({
    ...streamInput,
    workspace,
    projectSlug: workspace.projectSlug,
    chatId,
    messages,
    modelMessages,
    userMessageId,
    assistantId,
    mentions: [],
    captureTurnMessages: true,
    standalone: input.standalone,
    permissionLevel: input.permissionLevel,
    persistPermission: input.persistPermission,
    activeContext,
  })
}
