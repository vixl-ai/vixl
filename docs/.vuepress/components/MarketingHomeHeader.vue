<script setup lang="ts">
import { BookOpen as BookOpenIcon, Moon as MoonIcon, Sun as SunIcon } from '@lucide/vue'
import { RouteLink } from 'vuepress/client'
import { Button } from '@docs/components/ui/button'
import GithubMark from './GithubMark.vue'

const props = defineProps<{
  isDark: boolean
}>()

const emit = defineEmits<{
  toggleTheme: []
}>()

const githubUrl = 'https://github.com/vixl-ai/vixl'

const toggleTheme = (): void => {
  emit('toggleTheme')
}
</script>

<template>
  <header>
    <div class="mx-auto flex h-20 max-w-[88rem] items-center justify-between px-6">
      <RouteLink
        class="flex h-10 items-center text-4xl font-semibold leading-none tracking-tight text-foreground no-underline"
        to="/"
      >
        Vixl
      </RouteLink>
      <nav class="flex h-10 items-center gap-1">
        <Button as-child class="h-10" size="sm" variant="ghost">
          <RouteLink class="inline-flex h-10 items-center gap-1.5" to="/guide/">
            <BookOpenIcon class="size-4" />
            Docs
          </RouteLink>
        </Button>
        <Button as-child class="h-10" size="icon-sm" variant="ghost">
          <a
            aria-label="vixl on GitHub"
            :href="githubUrl"
            class="inline-flex h-10 w-10 items-center justify-center"
            rel="noopener noreferrer"
            target="_blank"
          >
            <GithubMark class="size-4" />
          </a>
        </Button>
        <Button
          :aria-label="props.isDark ? 'Switch to light theme' : 'Switch to dark theme'"
          class="h-10 w-10"
          size="icon-sm"
          variant="ghost"
          @click="toggleTheme"
        >
          <SunIcon v-if="props.isDark" class="size-4" />
          <MoonIcon v-else class="size-4" />
        </Button>
      </nav>
    </div>
  </header>
</template>
