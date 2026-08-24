<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/shadcn/ui/breadcrumb'
import useChatStore from '@/composables/use-chat-store'
import useFleetRegistry from '@/composables/use-fleet-registry'
import useFleetSidebar from '@/composables/use-fleet-sidebar'
import { HOME_CHAT_SLUG, isHomeChatSlug } from '@/constants/home-chat'
import chatRouteFor from '@/utils/chat-route-for'
import projectRouteFor from '@/utils/project-route-for'
import formatModelLabelFromRef from '@/utils/format-model-label-from-ref'

const route = useRoute()
const fleet = useFleetRegistry()
const fleetSidebar = useFleetSidebar()
const chatStore = useChatStore()

const isStandalone = computed(
  () =>
    route.name === 'home-chat' ||
    route.name === 'home-chat-subagent' ||
    isHomeChatSlug(String(route.params.slug ?? '')),
)
const projectSlug = computed(() =>
  isStandalone.value ? HOME_CHAT_SLUG : String(route.params.slug ?? ''),
)
const chatId = computed(() => String(route.params.chatId ?? ''))
const subagentId = computed(() => String(route.params.subagentId ?? ''))

const isChatRoute = computed(
  () =>
    (route.name === 'chat' ||
      route.name === 'home-chat' ||
      route.name === 'chat-subagent' ||
      route.name === 'home-chat-subagent') &&
    Boolean(chatId.value),
)

const projectName = computed(() => {
  if (isStandalone.value) {
    return 'Home'
  }
  const project = fleet.projects.value.find((item) => item.slug === projectSlug.value)
  return project?.name ?? projectSlug.value
})

const chatTitle = computed(() => {
  if (!chatId.value) {
    return 'Chat'
  }

  const routeMeta = chatStore.forChat(projectSlug.value, chatId.value).meta.value
  if (routeMeta?.title) {
    return routeMeta.title
  }

  if (isStandalone.value) {
    const standalone = fleetSidebar.standaloneChats.value.find(
      (item) => item.id === chatId.value,
    )
    if (standalone?.title) {
      return standalone.title
    }
  }

  const sidebarProject = fleetSidebar.sidebarProjects.value.find(
    (item) => item.slug === projectSlug.value,
  )
  const sidebarChat = sidebarProject?.chats.find((item) => item.id === chatId.value)
  if (sidebarChat?.title) {
    return sidebarChat.title
  }

  return 'Chat'
})

const subagentTitle = computed(() => {
  if (!subagentId.value) {
    return null
  }
  const item = chatStore.forChat(projectSlug.value, chatId.value).getSubagent(subagentId.value)
  const name = item?.name?.trim() || 'Sub-agent'
  const modelLabel = formatModelLabelFromRef(item?.model)
  if (!modelLabel) {
    return name
  }
  return `${name} on ${modelLabel}`
})

const parentChatTo = computed(() => chatRouteFor(projectSlug.value, chatId.value))

const projectTo = computed(() =>
  isStandalone.value ? { name: 'home' as const } : projectRouteFor(projectSlug.value),
)
</script>

<template>
  <div v-if="isChatRoute" class="flex min-w-0 items-center overflow-hidden">
    <Breadcrumb class="min-w-0 max-w-full overflow-hidden">
      <BreadcrumbList class="min-w-0 flex-nowrap gap-1.5 overflow-hidden text-xs sm:gap-1.5">
        <BreadcrumbItem class="shrink-0">
          <BreadcrumbLink as-child>
            <RouterLink
              :to="projectTo"
              class="block max-w-[8rem] truncate text-muted-foreground sm:max-w-[10rem]"
              :title="projectName"
            >
              {{ projectName }}
            </RouterLink>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator class="shrink-0" />
        <BreadcrumbItem
          :class="subagentTitle ? 'shrink-0' : 'min-w-0 overflow-hidden'"
        >
          <BreadcrumbLink
            v-if="subagentTitle"
            as-child
          >
            <RouterLink
              :to="parentChatTo"
              class="block min-w-0 max-w-[10rem] truncate text-muted-foreground sm:max-w-[14rem]"
              :title="chatTitle"
            >
              {{ chatTitle }}
            </RouterLink>
          </BreadcrumbLink>
          <BreadcrumbPage
            v-else
            class="block min-w-0 max-w-[14rem] truncate text-muted-foreground sm:max-w-[22rem]"
            :title="chatTitle"
          >
            {{ chatTitle }}
          </BreadcrumbPage>
        </BreadcrumbItem>
        <template v-if="subagentTitle">
          <BreadcrumbSeparator class="shrink-0" />
          <BreadcrumbItem class="min-w-0 overflow-hidden">
            <BreadcrumbPage
              class="block min-w-0 max-w-[14rem] truncate text-muted-foreground sm:max-w-[22rem]"
              :title="subagentTitle"
            >
              {{ subagentTitle }}
            </BreadcrumbPage>
          </BreadcrumbItem>
        </template>
      </BreadcrumbList>
    </Breadcrumb>
  </div>
</template>
