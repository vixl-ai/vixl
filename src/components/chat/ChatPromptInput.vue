<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { toast } from 'vue-sonner'
import type { ChatStatus } from 'ai'
import { FolderIcon, Layers, Layers2, ChevronDownIcon, XIcon, SquareIcon } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/shadcn/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import { Badge } from '@/components/shadcn/ui/badge'
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
import ChatPermissionDial from '@/components/chat/ChatPermissionDial.vue'
import ChatPromptAttachments from '@/components/chat/ChatPromptAttachments.vue'
import ChatPromptEditSync from '@/components/chat/ChatPromptEditSync.vue'
import ChatPromptMentionSync from '@/components/chat/ChatPromptMentionSync.vue'
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
import useContextUsage from '@/composables/use-context-usage'
import useMcpServers from '@/composables/use-mcp-servers'
import useVixlConfig from '@/composables/use-vixl-config'
import mcpRuntime from '@/services/mcp/mcp-runtime'
import connectionKey from '@/services/mcp/connection-key'
import normalizeCodegraphResult from '@/services/codegraph/normalize-codegraph-result'
import resolveModelForRole from '@/services/models/resolve-model-for-role'
import listConfiguredProviders from '@/services/providers/list-configured-providers'
import { normalizeStoredModelRef } from '@/schemas/vixl-settings'
import { HOME_CHAT_SLUG } from '@/constants/home-chat'
import { CODEGRAPH_SERVER_ID } from '@/types/codegraph/managed-codegraph'
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input/types'
import type { ContextMention } from '@/types/harness/context-mention'
import type { HarnessWorkspaceMember } from '@/types/harness/harness-workspace'
import type { PermissionLevel } from '@/types/harness/permission'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { FileUIPart } from 'ai'
import type { ChatPromptWorkspace } from '@/types/chat/chat-prompt-workspace'
import contextMentionFromNode from '@/utils/context-mention-from-node'
import normalizeAttachmentFiles from '@/utils/normalize-attachment-files'
import { membersFromDeclaredSlugs } from '@/utils/parse-member-qualified-name'

const PREFETCH_MIN_FREE_TOKENS = 4000
const PREFETCH_MAX_CONTENT_CHARS = 12_000

const props = withDefaults(
  defineProps<{
    status?: ChatStatus
    disabled?: boolean
    showProjectSelect?: boolean
    permissionLevel?: PermissionLevel
    waitingOnBackground?: boolean
    allowSubmitWhileBusy?: boolean
    hideModel?: boolean
    hideMode?: boolean
    hideStop?: boolean
  }>(),
  {
    status: 'ready',
    disabled: false,
    showProjectSelect: false,
    permissionLevel: undefined,
    waitingOnBackground: false,
    allowSubmitWhileBusy: false,
    hideModel: false,
    hideMode: false,
    hideStop: false,
  },
)

const emit = defineEmits<{
  submit: [payload: {
    text: string
    mode: VixlChatMode
    model: string
    workspace: ChatPromptWorkspace
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
const { transparencyEnabled } = useTransparency()

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

const session = reactive<{
  selectedMode: VixlChatMode
  selectedModelRef: string
  modeInitialized: boolean
  modelInitialized: boolean
  selectedProjectIds: string[]
  selectedGroupId: string | null
  projectSelectionInitialized: boolean
}>({
  selectedMode: 'agent',
  selectedModelRef: '',
  modeInitialized: false,
  modelInitialized: false,
  selectedProjectIds: [],
  selectedGroupId: null,
  projectSelectionInitialized: false,
})

const hasProviders = computed(
  () => listConfiguredProviders(config.effectiveSettings.value).length > 0,
)

const selectedModeMeta = computed(() => getChatModeMeta(session.selectedMode))

const fleetGroups = computed(() => fleet.groups?.value ?? [])

const selectedGroup = computed(
  () => fleetGroups.value.find((group) => group.id === session.selectedGroupId) ?? null,
)

const selectedProjects = computed(() =>
  session.selectedProjectIds
    .map((id) => fleet.projects.value.find((project) => project.id === id) ?? null)
    .filter((project): project is NonNullable<typeof project> => project !== null),
)

const promptWorkspace = computed((): ChatPromptWorkspace => {
  if (!props.showProjectSelect) {
    const activeId = fleet.activeProject.value?.id
    return activeId ? { kind: 'project', projectId: activeId } : { kind: 'home' }
  }
  if (session.selectedGroupId) {
    return { kind: 'group', groupId: session.selectedGroupId }
  }
  if (session.selectedProjectIds.length >= 2) {
    return { kind: 'projects', projectIds: [...session.selectedProjectIds] }
  }
  if (session.selectedProjectIds.length === 1) {
    return { kind: 'project', projectId: session.selectedProjectIds[0]! }
  }
  return { kind: 'home' }
})

const selectedProjectsFullName = computed(() =>
  selectedProjects.value.map((project) => project.name).join(', '),
)

const activeProjectName = computed(() => {
  if (!props.showProjectSelect) {
    return fleet.activeProject.value?.name ?? 'Home'
  }
  if (selectedGroup.value) {
    return selectedGroup.value.name
  }
  if (selectedProjects.value.length >= 3) {
    const names = selectedProjects.value.map((project) => project.name)
    return `${names[0]}, ${names[1]}, ${names[2]!.slice(0, 4)}...`
  }
  if (selectedProjects.value.length === 2) {
    return selectedProjectsFullName.value
  }
  if (selectedProjects.value.length === 1) {
    return selectedProjects.value[0]!.name
  }
  return 'Home'
})

const pickerIcon = computed(() => {
  const count = selectedGroup.value
    ? selectedGroup.value.memberSlugs.length
    : selectedProjects.value.length
  if (count >= 3) {
    return Layers
  }
  if (count === 2) {
    return Layers2
  }
  return FolderIcon
})

const projectPickerTitle = computed(() => {
  const name =
    !selectedGroup.value && selectedProjects.value.length >= 3
      ? selectedProjectsFullName.value
      : activeProjectName.value
  return name === 'Home' ? 'Home' : `${name} project`
})

const isWaitingOnReply = computed(
  () => props.status === 'submitted' || props.status === 'streaming',
)

const showStop = computed(
  () => (isWaitingOnReply.value || props.waitingOnBackground) && !props.hideStop,
)

const showSubmit = computed(
  () => !showStop.value || props.allowSubmitWhileBusy,
)

const isEditing = computed(() => chatStore.editingMessageId.value !== null)

const promptInputClass = computed(() => {
  const base =
    'w-full [&_[data-slot=input-group]]:rounded-xl [&_[data-slot=input-group]]:shadow-sm'
  if (isWaitingOnReply.value) {
    return base
  }
  const fill = transparencyEnabled.value
    ? '[&_[data-slot=input-group]]:bg-(--composer-fill)'
    : '[&_[data-slot=input-group]]:bg-background'
  return `${base} [&_[data-slot=input-group]]:border-border/50 ${fill}`
})

const selectedWorkspaceRoot = computed((): string | null => {
  if (selectedGroup.value) {
    const primarySlug = selectedGroup.value.memberSlugs[0]
    return (
      fleet.projects.value.find((project) => project.slug === primarySlug)?.rootPath ?? null
    )
  }
  return selectedProjects.value[0]?.rootPath ?? null
})

const promptWorkspaceRoot = computed((): string | null => {
  if (props.showProjectSelect) {
    return selectedWorkspaceRoot.value
  }

  if (chatStore.meta.value?.projectSlug === HOME_CHAT_SLUG) {
    return null
  }

  // Agent threads: resolve the same root git/context budget use so @ file
  // search can query the workspace. Slash commands use promptSlashRoot.
  const fromMeta = chatStore.meta.value?.projectRoot?.trim()
  if (fromMeta) {
    return fromMeta
  }
  return fleet.activeProject.value?.rootPath ?? null
})

const promptSlashRoot = computed((): string | null => {
  if (props.showProjectSelect) {
    return selectedWorkspaceRoot.value
  }

  if (chatStore.meta.value?.projectSlug === HOME_CHAT_SLUG) {
    return chatStore.meta.value.projectRoot?.trim() || null
  }

  const fromMeta = chatStore.meta.value?.projectRoot?.trim()
  if (fromMeta) {
    return fromMeta
  }
  return fleet.activeProject.value?.rootPath ?? null
})

const membersFromSlugs = (slugs: string[]): HarnessWorkspaceMember[] | undefined => {
  const members = membersFromDeclaredSlugs(slugs, fleet.projects.value)
  return members.length >= 2 ? members : undefined
}

const promptWorkspaceMembers = computed((): HarnessWorkspaceMember[] | undefined => {
  if (props.showProjectSelect) {
    if (selectedGroup.value) {
      return membersFromSlugs(selectedGroup.value.memberSlugs)
    }
    if (selectedProjects.value.length >= 2) {
      return selectedProjects.value.map((project) => ({
        slug: project.slug,
        name: project.name,
        rootPath: project.rootPath,
      }))
    }
    return undefined
  }

  const slug = chatStore.meta.value?.projectSlug
  if (!slug || slug === HOME_CHAT_SLUG) {
    return undefined
  }
  const group = fleetGroups.value.find((entry) => entry.slug === slug)
  if (!group) {
    return undefined
  }
  return membersFromSlugs(group.memberSlugs)
})

const showGitBranch = computed(
  () =>
    git.isRepo.value
    && promptWorkspaceRoot.value !== null
    && !promptWorkspaceMembers.value,
)

const { settings: rootEffectiveSettings } = useRootEffectiveSettings(
  () => promptWorkspaceRoot.value,
)

const resolveDefaultPermissionLevel = (): PermissionLevel =>
  props.permissionLevel
  ?? rootEffectiveSettings.value['agent.permissionLevel']
  ?? 'allowlist'

const localPermissionLevel = ref<PermissionLevel>(resolveDefaultPermissionLevel())

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

const activatePrimary = async (projectId: string | null): Promise<void> => {
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

const handleSelectHome = (): void => {
  session.selectedProjectIds = []
  session.selectedGroupId = null
}

const handleSelectGroup = async (groupId: string): Promise<void> => {
  session.selectedGroupId = groupId
  session.selectedProjectIds = []
  const group = (fleet.groups?.value ?? []).find((item) => item.id === groupId)
  const primarySlug = group?.memberSlugs[0]
  const primary = primarySlug
    ? fleet.projects.value.find((project) => project.slug === primarySlug)
    : undefined
  await activatePrimary(primary?.id ?? null)
}

const handleProjectToggle = async (projectId: string, checked: boolean): Promise<void> => {
  session.selectedGroupId = null
  if (checked) {
    if (!session.selectedProjectIds.includes(projectId)) {
      session.selectedProjectIds = [...session.selectedProjectIds, projectId]
    }
  } else {
    session.selectedProjectIds = session.selectedProjectIds.filter((id) => id !== projectId)
  }
  await activatePrimary(session.selectedProjectIds[0] ?? null)
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
  const codegraphScope =
    promptWorkspaceRoot.value ?? fleet.activeProject.value?.rootPath ?? null
  const codegraphConnected =
    mcpServers.serverStates.value[connectionKey(codegraphScope, CODEGRAPH_SERVER_ID)]
      ?.status === 'connected'
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
        undefined,
        codegraphScope,
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

let submitErrorAlreadyToasted = false

const handleSubmit = async (payload: PromptInputMessage): Promise<void> => {
  const text = payload.text.trim()
  const files: FileUIPart[] = payload.files ?? []
  if ((!text && files.length === 0) || props.disabled) {
    return
  }
  if (!session.selectedModelRef) {
    toast.error('Select a model before sending')
    return
  }
  if (isEditing.value) {
    emit('submitEdit', {
      text,
      mode: session.selectedMode,
      model: session.selectedModelRef,
    })
    return
  }

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

  let normalizedFiles: FileUIPart[]
  try {
    normalizedFiles = await normalizeAttachmentFiles(files)
  } catch (error) {
    toast.error('Could not attach image', {
      description: error instanceof Error ? error.message : 'Unknown error',
    })
    submitErrorAlreadyToasted = true
    throw error
  }

  emit('submit', {
    text,
    mode: session.selectedMode,
    model: session.selectedModelRef,
    workspace: promptWorkspace.value,
    permissionLevel: localPermissionLevel.value,
    files: normalizedFiles,
    mentions,
  })
}

const handlePromptInputError = (err: { code: string, message: string }): void => {
  if (err.code === 'accept') {
    toast.error('File type not supported')
    return
  }
  if (err.code === 'max_file_size') {
    toast.error('File is too large')
    return
  }
  if (err.code === 'max_files') {
    toast.error('Too many files')
    return
  }
  if (err.code === 'submit_error') {
    if (submitErrorAlreadyToasted) {
      submitErrorAlreadyToasted = false
      return
    }
    toast.error(err.message || 'Could not send message')
    return
  }
  toast.error(err.message || 'Could not attach files')
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
    const activeId = fleet.activeProject.value?.id ?? null
    session.selectedProjectIds = activeId ? [activeId] : []
    session.selectedGroupId = null
    session.projectSelectionInitialized = true
  },
  { immediate: true },
)

watch(
  [() => config.hydrated.value, rootEffectiveSettings],
  ([hydrated]) => {
    if (!hydrated) {
      return
    }
    if (props.permissionLevel === undefined) {
      localPermissionLevel.value =
        rootEffectiveSettings.value['agent.permissionLevel'] ?? 'allowlist'
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
          :title="projectPickerTitle"
        >
          <component :is="pickerIcon" class="size-4 shrink-0" />
          <span class="min-w-0 truncate text-sm">{{ activeProjectName }}</span>
          <ChevronDownIcon class="size-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-56">
        <DropdownMenuItem @select="handleSelectHome">
          Home
        </DropdownMenuItem>
        <template v-if="fleetGroups.length > 0">
          <DropdownMenuSeparator />
          <DropdownMenuItem
            v-for="group in fleetGroups"
            :key="group.id"
            @select="handleSelectGroup(group.id)"
          >
            <Layers class="size-4 shrink-0" />
            <span class="min-w-0 flex-1 truncate">{{ group.name }}</span>
            <Badge variant="outline" class="h-5 px-1.5 text-[10px]">Group</Badge>
          </DropdownMenuItem>
        </template>
        <DropdownMenuSeparator v-if="fleet.projects.value.length > 0" />
        <DropdownMenuCheckboxItem
          v-for="project in fleet.projects.value"
          :key="project.id"
          :model-value="session.selectedProjectIds.includes(project.id)"
          @select.prevent
          @update:model-value="(checked) => handleProjectToggle(project.id, Boolean(checked))"
        >
          {{ project.name }}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>

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
      <ChatPromptInputContextMenu>
        <PromptInput
        accept="image/*"
        :class="promptInputClass"
        multiple
        @submit="handleSubmit"
        @error="handlePromptInputError"
      >
        <ChatPromptAttachments />
        <ChatQueueHandlers ref="queueHandlersRef" />
        <PromptInputBody>
          <ChatPromptEditSync />
          <ChatPromptMentionSync />
          <ChatPromptEditor
            class="max-h-28 min-h-10"
            placeholder="@ for context, / for commands"
            :project-root="promptWorkspaceRoot"
            :slash-root="promptSlashRoot"
            :members="promptWorkspaceMembers"
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
            <PromptInputActionMenu v-if="!hideMode">
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
              v-if="!hideModel"
              :model-value="session.selectedModelRef"
              compact
              hide-disallowed
              :disabled="!hasProviders || disabled"
              placeholder="Select model"
              @update:model-value="handleModelChange"
            />
            <PromptInputSubmit
              v-if="showSubmit"
              class="shrink-0"
              :disabled="disabled"
            />
            <Tooltip v-if="showStop">
              <TooltipTrigger as-child>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  class="shrink-0 rounded-md"
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
      </ChatPromptInputContextMenu>
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
        <ChatMcpServerPicker
          :project-root="promptWorkspaceRoot"
          :members="promptWorkspaceMembers"
        />
      </div>
    </div>
  </div>
</template>
