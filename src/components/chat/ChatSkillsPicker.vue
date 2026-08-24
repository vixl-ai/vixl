<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckIcon, ChevronDownIcon, SparklesIcon } from '@lucide/vue'
import { Button } from '@/components/shadcn/ui/button'
import { Input } from '@/components/shadcn/ui/input'
import { Badge } from '@/components/shadcn/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/shadcn/ui/dropdown-menu'
import useChatSkills from '@/composables/use-chat-skills'
import useChatPromptBridge from '@/composables/use-chat-prompt-bridge'
import type { VixlChatMode } from '@/types/vixl/vixl-settings'
import type { SkillIndexEntry } from '@/types/skills/skill'

defineProps<{
  mode?: VixlChatMode
}>()

const menuOpen = ref(false)
const searchQuery = ref('')
const chatPromptBridge = useChatPromptBridge()

const { skills, pending, refresh } = useChatSkills()

const scopeLabel = (skill: SkillIndexEntry): string =>
  skill.scope === 'user' ? 'User' : 'Project'

const filteredSkills = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()
  if (!query) {
    return skills.value
  }
  return skills.value.filter(
    (skill) =>
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query),
  )
})

const handleOpenChange = async (open: boolean): Promise<void> => {
  menuOpen.value = open
  if (open) {
    searchQuery.value = ''
    await refresh()
  }
}

const handleSkillSelect = (name: string): void => {
  menuOpen.value = false
  searchQuery.value = ''
  chatPromptBridge.appendSkill(name)
}
</script>

<template>
  <DropdownMenu :open="menuOpen" @update:open="handleOpenChange">
    <DropdownMenuTrigger as-child>
      <Button
        variant="ghost"
        size="sm"
        class="h-7 min-w-0 gap-1.5 px-2 text-xs text-muted-foreground"
        :disabled="pending"
        :title="`${skills.length} skills available`"
        aria-label="Skills"
      >
        <SparklesIcon class="size-3.5 shrink-0" />
        <span class="max-w-32 min-w-0 truncate @max-[22rem]/composer:hidden">
          Skills
          <template v-if="skills.length > 0">({{ skills.length }})</template>
        </span>
        <ChevronDownIcon class="size-3 shrink-0 opacity-60" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" class="w-72 p-0">
      <div class="border-b border-border/50 p-2" @pointerdown.stop>
        <Input
          v-model="searchQuery"
          placeholder="Search skills…"
          class="h-8"
          @keydown.stop
        />
      </div>
      <div class="max-h-60 overflow-y-auto p-1">
        <DropdownMenuItem
          v-for="skill in filteredSkills"
          :key="`${skill.scope}:${skill.name}`"
          class="flex-col items-start gap-1 py-2"
          @select="handleSkillSelect(skill.name)"
        >
          <div class="flex w-full items-center gap-2">
            <CheckIcon class="size-3.5 shrink-0 opacity-0" />
            <span class="truncate font-medium">/{{ skill.name }}</span>
            <Badge variant="outline" class="ml-auto shrink-0">
              {{ scopeLabel(skill) }}
            </Badge>
          </div>
          <p
            v-if="skill.description"
            class="w-full truncate pl-5 text-xs text-muted-foreground"
          >
            {{ skill.description }}
          </p>
        </DropdownMenuItem>
        <p
          v-if="!pending && filteredSkills.length === 0"
          class="px-2 py-4 text-center text-sm text-muted-foreground"
        >
          {{
            searchQuery.trim()
              ? 'No skills match your search.'
              : 'No user or project skills available.'
          }}
        </p>
        <p
          v-else-if="pending"
          class="px-2 py-4 text-center text-sm text-muted-foreground"
        >
          Loading skills…
        </p>
      </div>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
