<script setup lang="ts">
import { Button } from '@landing/components/ui/button'
import { releasesUrl } from '@landing/data/features'
import { useOsDownloadLabel } from '@landing/composables/useOsDownloadLabel'
import { useReveal } from '@landing/composables/useReveal'

const downloadLabel = useOsDownloadLabel()
const { el, visible } = useReveal()
</script>

<template>
  <section
    ref="el"
    class="vx-closing relative isolate flex items-center justify-center bg-background pb-24 pt-14 lg:pb-36 lg:pt-20"
    aria-labelledby="closing-heading"
  >
    <div
      class="vx-container relative text-center"
      :class="visible ? 'vx-reveal-in' : 'vx-reveal-out'"
    >
      <h2
        id="closing-heading"
        class="vx-section-title vx-shimmer-text vx-shimmer-text--closing mx-auto w-fit text-balance text-[clamp(2.25rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.035em]"
      >
        Bring your own model.
      </h2>
      <div
        class="vx-closing-ctas mx-auto mt-8 flex w-full max-w-[20rem] flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center"
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
