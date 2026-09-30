<script setup lang="ts">
import { computed } from 'vue'
import { useWindowScroll } from '@vueuse/core'
import { Button } from '@landing/components/ui/button'
import ModeToggle from '@landing/components/ModeToggle.vue'
import { githubRepo, releasesUrl } from '@landing/data/features'
import { cn } from '@landing/lib/utils'

const { y } = useWindowScroll()
const scrolled = computed(() => y.value > 8)
const logoSrc = '/favicon.png'
</script>

<template>
  <header
    class="vx-site-header sticky top-0 z-50 w-full transition-[background-color,border-color,backdrop-filter] duration-300"
    :class="
      cn(
        scrolled
          ? 'border-b border-border/60 bg-background/70 backdrop-blur-xl'
          : 'border-0 border-transparent bg-transparent shadow-none backdrop-blur-none',
      )
    "
  >
    <div
      class="vx-container flex h-14 items-center justify-between gap-2 sm:h-16"
    >
      <a
        href="/"
        class="group flex min-w-0 shrink-0 items-center gap-2"
      >
        <img
          :src="logoSrc"
          alt=""
          width="28"
          height="28"
          class="size-6 shrink-0 rounded-md sm:size-7"
        >
        <span class="text-[1.0625rem] font-semibold tracking-[-0.01em] text-foreground">
          Vixl
        </span>
      </a>

      <nav
        class="flex shrink-0 items-center gap-1 sm:gap-2"
        aria-label="Primary"
      >
        <Button as-child size="sm" class="h-10 sm:h-8">
          <a :href="releasesUrl">Download</a>
        </Button>
        <a
          href="/getting-started/"
          class="inline-flex h-10 items-center px-2 text-[0.875rem] font-medium text-foreground transition-colors hover:text-foreground/80"
        >
          Docs
        </a>
        <a
          :href="githubRepo"
          aria-label="Vixl on GitHub"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex size-10 items-center justify-center text-foreground transition-colors hover:text-foreground/80 sm:size-8"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="size-4"
            aria-hidden="true"
          >
            <path
              d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
            />
          </svg>
        </a>
        <ModeToggle />
      </nav>
    </div>
  </header>
</template>
