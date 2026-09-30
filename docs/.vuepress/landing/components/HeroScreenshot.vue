<script setup lang="ts">
import { useReveal } from '@landing/composables/useReveal'

const HERO_LIGHT = '/media/landing/hero-light.webp'
const HERO_DARK = '/media/landing/hero-dark.webp'

const { el, visible } = useReveal()
</script>

<template>
  <section
    ref="el"
    class="vx-demo relative z-10 mt-14 px-0 lg:mt-20"
    aria-labelledby="demo-heading"
  >
    <div class="sr-only">
      <h2 id="demo-heading">Product preview</h2>
      <p>
        Screenshot of the Vixl desktop app: chat, agent plan, code editor, and project files in one window.
      </p>
    </div>

    <div class="vx-container">
      <div
        class="vx-media-frame relative w-full"
        :class="visible ? 'vx-demo-reveal-in' : 'vx-demo-reveal-out'"
      >
        <div class="vx-demo-glow pointer-events-none absolute inset-0 -z-10" aria-hidden="true" />
        <div class="vx-glass-frame relative overflow-hidden rounded-xl shadow-[0_24px_64px_-32px_rgba(0,0,0,0.35)]">
          <div class="vx-demo-aspect relative w-full">
            <div
              class="vx-demo-surface pointer-events-none absolute inset-0 z-0"
              aria-hidden="true"
            />

            <img
              :src="HERO_LIGHT"
              alt="Vixl desktop app in light theme, showing chat, editor, and files"
              width="2400"
              height="960"
              class="absolute inset-0 z-10 size-full object-cover dark:hidden"
              loading="eager"
              fetchpriority="high"
              decoding="async"
            >
            <img
              :src="HERO_DARK"
              alt="Vixl desktop app in dark theme, showing chat, editor, and files"
              width="2400"
              height="960"
              class="absolute inset-0 z-10 hidden size-full object-cover dark:block"
              loading="eager"
              fetchpriority="high"
              decoding="async"
            >
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
