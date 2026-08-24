<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { ChatStatus } from 'ai'
import { FolderIcon, ChevronDownIcon, XIcon, SquareIcon } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input'
import ChatGitBranchSelect from '@/components/chat/GitBranchSelect.vue'
import ChatMcpServerPicker from '@/components/chat/ChatMcpServerPicker.vue'
import ChatSkillsPicker from '@/components/chat/ChatSkillsPicker.vue'
import ChatPermissionDial from '@/components/chat/ChatPermissionDial.vue'
import ChatPromptAttachments from '@/components/chat/ChatPromptAttachments.vue'
import ChatPromptEditSync from '@/components/chat/ChatPromptEditSync.vue'
import ChatPromptBrowserElementSync from '@/components/chat/ChatPromptBrowserElementSync.vue'
import ChatPromptMentionSync from '@/components/chat/ChatPromptMentionSync.vue'
import ChatPromptSkillSync from '@/components/chat/ChatPromptSkillSync.vue'
import ChatQueueHandlers from '@/components/chat/ChatQueueHandlers.vue'
import ChatPromptEditor from '@/components/chat/prompt-editor/ChatPromptEditor.vue'
import type { QueuedChatMessage } from '@/types/chat/queued-chat-message'
import ModelsOptionsModelOptionsRow from '@/components/models/options/ModelOptionsRow.vue'
import { CHAT_MODES, getChatModeMeta } from '@/constants/chat-modes'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useGitBranches from '@/composables/use-git-branches'
import useChatStore from '@/composables/use-chat-store'
import useChatContextBudgetSync from '@/composables/use-chat-context-budget-sync'
import useChatPromptEditor from '@/composables/use-chat-prompt-editor'
import useChatPromptDraftMedia from '@/composables/use-chat-prompt-draft-media'
import useContextUsage from '@/composables/use-context-usage'
import useMcpServers from '@/composables/use-mcp-servers'
import useVixlConfig from '@/composables/use-vixl-config'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import normalizeCodegraphResult from '@/services/codegraph/normalize-codegraph-result'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import listConfiguredProviders from '@/services/providers/list-configured-providers'
import { normalizeStoredModelRef } from '@/schemas/vixl-settings'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import { CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input/types'
import type { ContextMention } from '@/types/harness/context-mention'
import type { PermissionLevel } from '@/types/harness/permission'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { FileUIPart } from 'ai'
import resolveSelectedModelVision from '@/services/harness/resolve-selected-model-vision'
import contextMentionFromNode from '@/utils/context-mention-from-node'
import draftElementMediaToFileParts from '@/utils/draft-element-media-to-file-parts'

const PREFETCH_MIN_FREE_TOKENS = 4000
const PREFETCH_MAX_CONTENT_CHARS = 12_000

const props = withDefaults(
  defineProps<{
    status?: ChatStatus
    disabled?: boolean
    showProjectSelect?: boolean
    permissionLevel?: PermissionLevel
    waitingOnBackground?: boolean
  }>(),
  {
    status: 'ready',
    disabled: false,
    showProjectSelect: false,
    permissionLevel: undefined,
    waitingOnBackground: false,
  },
)

const emit = defineEmits<{
  submit: [payload: {
    text: string
    mode: VixlChatMode
    model: string
    projectId: string | null
    permissionLevel: PermissionLevel
    files?: FileUIPart[]
    mentions?: ContextMention[]
  }]
  submitEdit: [payload: {
    text: string
    mode: VixlChatMode
    model: string
  }]
  stop: []
  'update:permissionLevel': [value: PermissionLevel]
}>()

const fleet = useFleetRegistry()
const config = useVixlConfig()
const git = useGitBranches()
const chatStore = useChatStore()
const contextBudgetSync = useChatContextBudgetSync()
const chatPromptEditor = useChatPromptEditor()
const contextUsage = useContextUsage()
const mcpServers = useMcpServers()
const draftMedia = useChatPromptDraftMedia()

const draftMentions = contextBudgetSync.draftMentions

const queueHandlersRef = ref<{
  hydrateQueuedMessage: (item: QueuedChatMessage) => Promise<void>
} | null>(null)

const hydrateQueuedMessage = async (item: QueuedChatMessage): Promise<void> => {
  await queueHandlersRef.value?.hydrateQueuedMessage(item)
}

defineExpose<{ hydrateQueuedMessage: (item: QueuedChatMessage) => Promise<void> }>({
  hydrateQueuedMessage,
})

const syncDraftSelection = (): void => {
  contextBudgetSync.setDraftSelection(session.selectedModelRef, session.selectedMode)
}

const resolveDefaultPermissionLevel = (): PermissionLevel =>
  props.permissionLevel
  ?? config.effectiveSettings.value['agent.permissionLevel']
  ?? 'allowlist'

const localPermissionLevel = ref<PermissionLevel>(resolveDefaultPermissionLevel())

const session = reactive<{
  selectedMode: VixlChatMode
  selectedModelRef: string
  modeInitialized: boolean
  modelInitialized: boolean
  selectedProjectId: string | null
  projectSelectionInitialized: boolean
}>({
  selectedMode: 'agent',
  selectedModelRef: '',
  modeInitialized: false,
  modelInitialized: false,
  selectedProjectId: null,
  projectSelectionInitialized: false,
})

const hasProviders = computed(
  () => listConfiguredProviders(config.effectiveSettings.value).length > 0,
)

const selectedModeMeta = computed(() => getChatModeMeta(session.selectedMode))

const activeProjectName = computed(() => {
  if (!props.showProjectSelect) {
    return fleet.activeProject.value?.name ?? 'No project'
  }
  if (session.selectedProjectId === null) {
    return 'No project'
  }
  return (
    fleet.projects.value.find((project) => project.id === session.selectedProjectId)?.name ??
    'No project'
  )
})

const isWaitingOnReply = computed(
  () => props.status === 'submitted' || props.status === 'streaming',
)

const isEditing = computed(() => chatStore.editingMessageId.value !== null)

const promptInputClass = computed(() => {
  const base =
    'w-full [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:shadow-sm'
  if (isWaitingOnReply.value) {
    return base
  }
  return `${base} [&_[data-slot=input-group]]:border-border/50 [&_[data-slot=input-group]]:bg-background`
})

const promptWorkspaceRoot = computed((): string | null => {
  if (props.showProjectSelect) {
    if (session.selectedProjectId === null) {
      return null
    }
    return (
      fleet.projects.value.find((project) => project.id === session.selectedProjectId)
        ?.rootPath ?? null
    )
  }

  if (chatStore.meta.value?.projectSlug === HOME_CHAT_SLUG) {
    return null
  }

  // Agent threads: resolve the same root git/context budget use so @ file
  // search and slash skills can query the workspace.
  const fromMeta = chatStore.meta.value?.projectRoot?.trim()
  if (fromMeta) {
    return fromMeta
  }
  return fleet.activeProject.value?.rootPath ?? null
})

const showGitBranch = computed(
  () => git.isRepo.value && promptWorkspaceRoot.value !== null,
)

const resolveInitialModelRef = (mode: VixlChatMode, metaModel?: string): string => {
  const settings = config.effectiveSettings.value
  const normalizedMeta = metaModel
    ? normalizeStoredModelRef(metaModel) ?? metaModel
    : undefined

  if (normalizedMeta) {
    return normalizedMeta
  }

  return resolveModelForRole(mode, settings) ?? ''
}

const handleModeSelect = (mode: VixlChatMode): void => {
  session.selectedMode = mode
  if (!session.selectedModelRef) {
    const resolved = resolveModelForRole(mode, config.effectiveSettings.value)
    if (resolved) {
      session.selectedModelRef = resolved
    }
  }
  syncDraftSelection()
}

const handleProjectSelect = async (projectId: string | null): Promise<void> => {
  session.selectedProjectId = projectId
  if (!projectId) {
    return
  }
  try {
    await fleet.setActiveProject(projectId)
  } catch (error) {
    toast.error('Could not switch project', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}

const handleModelChange = (value: string): void => {
  if (value.length > 0) {
    session.selectedModelRef = value
    syncDraftSelection()
  }
}

const handlePermissionLevelChange = (level: PermissionLevel): void => {
  localPermissionLevel.value = level
  emit('update:permissionLevel', level)
}

const enrichMentionsBeforeSend = async (
  mentions: ContextMention[],
): Promise<ContextMention[]> => {
  const codegraphConnected =
    mcpServers.serverStates.value[CODEGRAPH_SERVER_ID]?.status === 'connected'
  if (!codegraphConnected) {
    return mentions
  }

  const freeTokens = contextUsage.free.value
  const maxChars = Math.min(
    PREFETCH_MAX_CONTENT_CHARS,
    Math.max(0, (freeTokens - 1000) * 4),
  )
  if (freeTokens < PREFETCH_MIN_FREE_TOKENS || maxChars < 500) {
    return mentions
  }

  const enriched: ContextMention[] = []
  for (const mention of mentions) {
    if (mention.type !== 'codebase' || mention.content) {
      enriched.push(mention)
      continue
    }
    try {
      const raw = await mcpRuntime.callTool(
        CODEGRAPH_SERVER_ID,
        'codegraph_explore',
        { query: mention.query },
      )
      const normalized = normalizeCodegraphResult.tool(raw)
      const content = [
        normalized.summary,
        ...normalized.results.map((span) => {
          const loc = `${span.path}:${span.startLine}-${span.endLine}`
          return span.snippet ? `${loc}\n${span.snippet}` : loc
        }),
      ]
        .filter((part): part is string => typeof part === 'string' && part.length > 0)
        .join('\n\n')
        .slice(0, maxChars)
      enriched.push(content.length > 0 ? { ...mention, content } : mention)
    } catch (error) {
      toast.error('Could not prefetch codebase context', {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
      enriched.push(mention)
    }
  }
  return enriched
}

const handleSubmit = async (payload: PromptInputMessage): Promise<void> => {
  const text = payload.text.trim()
  const promptFiles = payload.files ?? []
  const draftItems = [...draftMedia.items.value]
  if ((!text && promptFiles.length === 0 && draftItems.length === 0) || props.disabled) {
    return
  }
  if (!session.selectedModelRef) {
    toast.error('Select a model before sending')
    return
  }
  if (isEditing.value) {
    emit('submitEdit', {
      text: text || (promptFiles.length > 0 ? 'See attached image(s).' : ''),
      mode: session.selectedMode,
      model: session.selectedModelRef,
    })
    return
  }

  const supportsVision = await resolveSelectedModelVision({
    modelRef: session.selectedModelRef,
    settings: config.effectiveSettings.value,
  })
  const elementFiles = draftElementMediaToFileParts(draftItems, supportsVision)
  if (draftItems.length > 0) {
    draftMedia.clear()
  }
  const files: FileUIPart[] = [...promptFiles, ...elementFiles]
  const fallbackText =
    elementFiles.length > 0 && promptFiles.length === 0
      ? 'See attached element(s).'
      : 'See attached image(s).'

  let mentions = (() => {
    const editor = chatPromptEditor.editorRef.value
    if (editor) {
      return contextMentionFromNode.collectFromEditor(editor)
    }
    return [...draftMentions.value]
  })()
  try {
    mentions = await enrichMentionsBeforeSend(mentions)
  } catch (error) {
    toast.error('Could not prepare context mentions', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
  }
  contextBudgetSync.setDraftMentions(mentions)

  emit('submit', {
    text: text || (files.length > 0 ? fallbackText : ''),
    mode: session.selectedMode,
    model: session.selectedModelRef,
    projectId: props.showProjectSelect
      ? session.selectedProjectId
      : fleet.activeProject.value?.id ?? null,
    permissionLevel: localPermissionLevel.value,
    files,
    mentions,
  })
}

const handleCancelEdit = (): void => {
  chatStore.cancelEditMessage()
}

watch(
  promptWorkspaceRoot,
  (root) => {
    git.setWorkspaceRoot(root)
  },
  { immediate: true },
)

watch(
  () => props.permissionLevel,
  (level) => {
    if (level !== undefined) {
      localPermissionLevel.value = level
    }
  },
)

watch(
  () => fleet.loaded.value,
  (loaded) => {
    if (!loaded || session.projectSelectionInitialized || !props.showProjectSelect) {
      return
    }
    session.selectedProjectId = fleet.activeProject.value?.id ?? null
    session.projectSelectionInitialized = true
  },
  { immediate: true },
)

watch(
  () => config.hydrated.value,
  (hydrated) => {
    if (!hydrated) {
      return
    }
    if (props.permissionLevel === undefined) {
      localPermissionLevel.value =
        config.effectiveSettings.value['agent.permissionLevel'] ?? 'allowlist'
    }
    if (!session.modeInitialized) {
      session.selectedMode = 'agent'
      session.modeInitialized = true
    }
    if (!session.modelInitialized) {
      const resolved = resolveInitialModelRef(session.selectedMode)
      if (resolved) {
        session.selectedModelRef = resolved
      }
      session.modelInitialized = true
    }
    syncDraftSelection()
  },
  { immediate: true },
)

watch(
  [
    () => chatStore.meta.value?.model,
    () => chatStore.meta.value?.mode,
  ],
  ([model, mode]) => {
    if (!chatStore.meta.value) {
      return
    }
    if (model) {
      const normalized =
        normalizeStoredModelRef(model) ?? model
      session.selectedModelRef = normalized.includes('::')
        ? normalized
        : resolveInitialModelRef(mode ?? session.selectedMode, undefined)
    }
    if (mode) {
      session.selectedMode = mode
    }
    syncDraftSelection()
  },
  { immediate: true },
)
</script>

<template>
  <div class="@container/composer mx-auto flex w-full max-w-3xl flex-col">
    <DropdownMenu v-if="showProjectSelect">
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="mb-2 h-8 w-fit max-w-full gap-1.5 px-1 text-muted-foreground hover:text-foreground"
          :title="`${activeProjectName} project`"
        >
          <FolderIcon class="size-4 shrink-0" />
          <span class="truncate text-sm">{{ activeProjectName }}</span>
          <ChevronDownIcon class="size-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-56">
        <DropdownMenuItem @select="handleProjectSelect(null)">
          No project
        </DropdownMenuItem>
        <DropdownMenuItem
          v-for="project in fleet.projects.value"
          :key="project.id"
          @select="handleProjectSelect(project.id)"
        >
          {{ project.name }}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>

    <ChatBrowserLockChip class="mb-2" />

    <div
      v-if="isEditing"
      class="mb-2 flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-1.5 text-sm text-muted-foreground"
    >
      <span>Editing message</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="h-7 gap-1 px-2"
        @click="handleCancelEdit"
      >
        <XIcon class="size-3.5" />
        Cancel
      </Button>
    </div>

    <div :class="isWaitingOnReply ? 'chat-prompt-aurora' : undefined">
      <PromptInput
        accept="image/*"
        :class="promptInputClass"
        multiple
        @submit="handleSubmit"
      >
        <ChatPromptAttachments />
        <ChatQueueHandlers ref="queueHandlersRef" />
        <PromptInputBody>
          <ChatPromptEditSync />
          <ChatPromptMentionSync />
          <ChatPromptSkillSync />
          <ChatPromptBrowserElementSync />
          <ChatPromptEditor
            class="max-h-28 min-h-10"
            placeholder="@ for context, / for commands"
            :project-root="promptWorkspaceRoot"
          />
        </PromptInputBody>
        <PromptInputFooter class="w-full min-w-0 flex-nowrap px-1 pb-1">
          <PromptInputTools class="shrink-0 gap-1">
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments label="Upload photos or files" />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger
                size="sm"
                class="shrink-0"
                :title="`${selectedModeMeta.label} mode`"
              >
                <component :is="selectedModeMeta.icon" class="size-4 shrink-0" />
                <span class="text-sm @max-[22rem]/composer:hidden">{{ selectedModeMeta.label }}</span>
              </PromptInputActionMenuTrigger>
              <PromptInputActionMenuContent>
                <PromptInputActionMenuItem
                  v-for="mode in CHAT_MODES"
                  :key="mode.value"
                  class="gap-2"
                  @select="handleModeSelect(mode.value)"
                >
                  <component :is="mode.icon" class="size-4 shrink-0" />
                  {{ mode.label }}
                </PromptInputActionMenuItem>
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
          </PromptInputTools>
          <PromptInputTools class="ml-auto min-w-0 items-center gap-2">
            <ModelsOptionsModelOptionsRow
              :model-value="session.selectedModelRef"
              compact
              hide-disallowed
              :disabled="!hasProviders || disabled"
              placeholder="Select model"
              @update:model-value="handleModelChange"
            />
            <PromptInputSubmit
              v-if="!isWaitingOnReply && !waitingOnBackground"
              class="shrink-0"
              :disabled="disabled"
            />
            <Tooltip v-else>
              <TooltipTrigger as-child>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  class="shrink-0 rounded-full"
                  aria-label="Stop generating"
                  @click="emit('stop')"
                >
                  <SquareIcon class="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Stop generating</TooltipContent>
            </Tooltip>
          </PromptInputTools>
        </PromptInputFooter>
      </PromptInput>
    </div>
    <div class="mt-1 flex w-full min-w-0 items-center justify-between gap-1 px-1">
      <div class="flex min-w-0 items-center gap-1">
        <ChatPermissionDial
          :model-value="localPermissionLevel"
          @update:model-value="handlePermissionLevelChange"
        />
        <ChatGitBranchSelect v-if="showGitBranch" />
      </div>
      <div class="flex min-w-0 items-center gap-1">
        <ChatMcpServerPicker />
        <ChatSkillsPicker :mode="session.selectedMode" />
      </div>
    </div>
  </div>
</template>
