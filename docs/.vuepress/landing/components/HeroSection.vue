<script setup lang="ts">
import { Button } from '@landing/components/ui/button'
import { releasesUrl } from '@landing/data/features'
import { useOsDownloadLabel } from '@landing/composables/useOsDownloadLabel'
import { useReveal } from '@landing/composables/useReveal'

const downloadLabel = useOsDownloadLabel()
const { el, visible } = useReveal({ rootMargin: '0px', threshold: 0 })
</script>

<template>
  <section
    ref="el"
    class="vx-hero relative isolate"
    aria-labelledby="hero-heading"
  >
    <div
      class="vx-container relative flex flex-col items-center pt-8 text-center lg:pt-10"
      :class="visible ? 'vx-reveal-in' : 'vx-reveal-out'"
    >
      <h1
        id="hero-heading"
        class="max-w-[16ch] text-balance text-[clamp(3.35rem,2.45rem+4.1vw,7rem)] font-extrabold leading-[0.98] tracking-[-0.05em] text-foreground"
      >
        <span class="block text-nowrap">
          The <span class="vx-hero-local">local</span><span class="sm:hidden"> AI</span>
        </span>
        <span class="block text-nowrap">
          <span class="hidden sm:inline">AI </span>coding agent
        </span>
      </h1>

      <p
        class="relative mt-6 max-w-[36rem] text-pretty text-[1.125rem] font-[450] leading-[1.55] text-foreground/80 before:pointer-events-none before:absolute before:inset-[-0.4rem_-1.35rem] before:-z-10 before:rounded-[2rem] before:content-[''] dark:text-foreground/85 dark:before:bg-background/50 dark:before:blur-2xl lg:text-[1.25rem]"
      >
        Plan, build, and ship with any model. Bring your own key or run one on your machine. No account, no subscription.
      </p>

      <div
        class="vx-hero-ctas mt-10 flex w-full max-w-[20rem] flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center"
      >
        <Button as-child size="cta" class="w-full sm:w-auto">
          <a :href="releasesUrl">{{ downloadLabel }}</a>
        </Button>
        <Button as-child variant="outline" size="cta" class="w-full sm:w-auto">
          <a href="/getting-started/">Read the docs</a>
        </Button>
      </div>
    </div>
  </section>
</template>
