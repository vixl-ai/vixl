<script setup lang="ts">
import type { FeatureSection } from '@landing/data/features'
import MonoText from '@landing/components/MonoText.vue'
import { useReveal } from '@landing/composables/useReveal'

const props = defineProps<{
  feature: FeatureSection
}>()

const { el, visible } = useReveal()

const lightSrc = `/media/landing/${props.feature.scene}-light.webp`
const darkSrc = `/media/landing/${props.feature.scene}-dark.webp`
</script>

<template>
  <section
    :id="feature.id"
    ref="el"
    class="vx-feature relative scroll-mt-24 py-10 lg:py-[3.75rem]"
    :class="`vx-feature--${feature.accent}`"
    :aria-labelledby="`${feature.id}-heading`"
  >
    <div
      class="vx-container relative grid items-center gap-10 lg:grid-cols-12 lg:gap-x-10"
    >
      <div
        class="min-w-0 text-left lg:col-span-4 lg:col-start-1"
        :class="visible ? 'vx-reveal-in' : 'vx-reveal-out'"
      >
        <h2
          :id="`${feature.id}-heading`"
          class="vx-section-title text-[clamp(2.25rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.035em]"
        >
          {{ feature.name }}
        </h2>
        <p
          class="mt-4 max-w-[32rem] text-pretty text-[1.125rem] leading-[1.65] text-muted-foreground"
        >
          <MonoText :text="feature.description" />
        </p>
        <a
          :href="feature.learnMoreHref"
          class="vx-learn-more mt-7 inline-flex min-h-10 items-center gap-1.5 text-[0.9375rem] font-medium text-foreground hover:underline hover:underline-offset-4"
          :aria-label="feature.learnMoreLabel"
        >
          <span aria-hidden="true">Learn more</span>
          <span class="vx-learn-arrow" aria-hidden="true">→</span>
        </a>
      </div>

      <div
        class="vx-feature-media relative min-w-0 w-full lg:col-span-8 lg:col-start-5"
        :class="visible ? 'vx-reveal-in vx-reveal-delay' : 'vx-reveal-out'"
      >
        <div class="vx-feature-glow pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
        <div class="vx-feature-frame relative overflow-hidden rounded-xl border border-border shadow-[0_24px_64px_-32px_rgba(0,0,0,0.35)]">
          <div class="relative w-full" style="aspect-ratio: 5 / 2">
            <div
              class="vx-img-placeholder pointer-events-none absolute inset-0 z-0"
              aria-hidden="true"
            />
            <img
              :src="lightSrc"
              :alt="feature.altLight"
              width="2400"
              height="960"
              loading="lazy"
              decoding="async"
              class="absolute inset-0 z-10 size-full object-contain object-top dark:hidden"
              @error="($event.target as HTMLImageElement).classList.add('vx-img-missing')"
            >
            <img
              :src="darkSrc"
              :alt="feature.altDark"
              width="2400"
              height="960"
              loading="lazy"
              decoding="async"
              class="absolute inset-0 z-10 hidden size-full object-contain object-top dark:block"
              @error="($event.target as HTMLImageElement).classList.add('vx-img-missing')"
            >
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
