<script setup lang="ts">
import { ArrowRight, ArrowUpRight } from '@lucide/vue'
import { RouteLink } from 'vuepress/client'
import { Button } from '@docs/components/ui/button'
import GithubMark from '../components/GithubMark.vue'
import MarketingHomeHeader from '../components/MarketingHomeHeader.vue'
import useMarketingTheme from '../composables/use-marketing-theme'

const releasesUrl = 'https://github.com/vixl-ai/vixl/releases'

const { isDark, toggleTheme } = useMarketingTheme()
</script>

<template>
  <div :class="isDark ? 'dark scheme-dark' : 'scheme-light'">
    <div class="marketing-home min-h-screen bg-background text-foreground">
      <MarketingHomeHeader :is-dark="isDark" @toggle-theme="toggleTheme" />

      <main class="flex flex-col items-center pb-16">
        <section class="flex w-full max-w-[88rem] flex-col items-center px-6 pt-10">
          <h1 class="max-w-5xl text-center text-5xl font-semibold tracking-tight sm:text-6xl lg:text-7xl">
            Local First Agents UI
          </h1>
          <div class="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button as-child class="h-12 rounded-full px-8" size="lg">
              <RouteLink class="inline-flex items-center gap-2" to="/guide/">
                Read the docs
                <ArrowRight class="size-4" />
              </RouteLink>
            </Button>
            <Button
              as-child
              class="h-12 rounded-full border border-border/80 px-8"
              size="lg"
              variant="ghost"
            >
              <a
                :href="releasesUrl"
                class="inline-flex items-center gap-2"
                rel="noopener noreferrer"
                target="_blank"
              >
                <GithubMark class="size-4" />
                Releases
                <ArrowUpRight class="size-4" />
              </a>
            </Button>
          </div>
          <div
            class="mt-12 w-full overflow-hidden rounded-[2rem] bg-gradient-to-br from-[#cfeee0] via-[#d0e4f8] to-[#e3d7f6] p-4 dark:from-[#9ee0c0] dark:via-[#9cc7f5] dark:to-[#cbb8f2]"
          >
            <img
              alt="Vixl desktop app showing agent chat, editor, and file tree"
              class="w-full rounded-[1.35rem]"
              src="/hero.png"
            />
          </div>
        </section>
      </main>
    </div>
  </div>
</template>
