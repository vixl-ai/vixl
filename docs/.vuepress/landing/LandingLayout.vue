<script setup lang="ts">
import { onMounted } from 'vue'
import SiteHeader from '@landing/components/SiteHeader.vue'
import HeroSection from '@landing/components/HeroSection.vue'
import HeroScreenshot from '@landing/components/HeroScreenshot.vue'
import SponsorsSection from '@landing/components/SponsorsSection.vue'
import FeatureSection from '@landing/components/FeatureSection.vue'
import PrinciplesSection from '@landing/components/PrinciplesSection.vue'
import ClosingCta from '@landing/components/ClosingCta.vue'
import SiteFooter from '@landing/components/SiteFooter.vue'
import AuroraBackground from '@landing/components/AuroraBackground.vue'
import { features } from '@landing/data/features'
import { useLandingColorMode } from '@landing/composables/useLandingColorMode'

const { mode, resolved } = useLandingColorMode()

onMounted(() => {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-theme', resolved.value)
  document.documentElement.classList.toggle('dark', resolved.value === 'dark')
  void mode.value
})
</script>

<template>
  <div class="vx-landing relative min-h-screen overflow-x-clip bg-background text-foreground">
    <SiteHeader />
    <main class="relative z-10 -mt-14 sm:-mt-16">
      <div class="vx-atmosphere relative isolate">
        <div
          class="vx-atmosphere-aurora pointer-events-none absolute inset-0"
          aria-hidden="true"
        >
          <AuroraBackground intensity="hero" />
        </div>
        <HeroSection />
        <HeroScreenshot />
      </div>
      <SponsorsSection />
      <FeatureSection
        v-for="feature in features"
        :key="feature.id"
        :feature="feature"
      />
      <PrinciplesSection />
      <ClosingCta />
    </main>
    <SiteFooter />
  </div>
</template>
