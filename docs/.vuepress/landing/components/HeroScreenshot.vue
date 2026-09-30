<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useReveal } from '@landing/composables/useReveal'
import { useLandingColorMode } from '@landing/composables/useLandingColorMode'
import {
  HERO_IMAGE_SIZES,
  landingImageSrc,
  landingImageSrcset,
} from '@landing/lib/media'

const { el, visible } = useReveal()
const { resolved } = useLandingColorMode()

const imgEl = ref<HTMLImageElement | null>(null)
const hydrated = ref(false)

// SSR can only follow the OS scheme; after hydration the source follows the
// resolved theme so a stored override or the toggle picks the right shot.
const darkMedia = computed(() => {
  if (!hydrated.value) return '(prefers-color-scheme: dark)'
  return resolved.value === 'dark' ? 'all' : 'not all'
})

onMounted(async () => {
  hydrated.value = true
  const root = document.documentElement
  if (!root.classList.contains('vx-theme-override')) return
  await nextTick()
  const reveal = () => root.classList.remove('vx-theme-override')
  imgEl.value?.addEventListener('load', reveal, { once: true })
  imgEl.value?.addEventListener('error', reveal, { once: true })
  setTimeout(reveal, 3000)
})
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

            <picture>
              <source
                :media="darkMedia"
                :srcset="landingImageSrcset('hero-dark')"
                :sizes="HERO_IMAGE_SIZES"
                type="image/webp"
              >
              <img
                ref="imgEl"
                :src="landingImageSrc('hero-light')"
                :srcset="landingImageSrcset('hero-light')"
                :sizes="HERO_IMAGE_SIZES"
                alt="Vixl desktop app showing chat, editor, and files"
                width="2400"
                height="960"
                class="vx-hero-shot absolute inset-0 z-10 size-full object-cover"
                loading="eager"
                fetchpriority="high"
                decoding="async"
              >
            </picture>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
