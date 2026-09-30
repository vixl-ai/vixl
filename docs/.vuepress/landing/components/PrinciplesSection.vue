<script setup lang="ts">
import { principles } from '@landing/data/features'
import { useReveal } from '@landing/composables/useReveal'

const { el, visible } = useReveal()
</script>

<template>
  <section
    ref="el"
    class="vx-principles relative py-11 lg:py-16"
    aria-labelledby="principles-heading"
  >
    <div
      class="vx-container relative"
      :class="visible ? 'vx-reveal-in' : 'vx-reveal-out'"
    >
      <h2
        id="principles-heading"
        class="vx-section-title text-left text-[clamp(2.25rem,4vw,3rem)] font-semibold leading-[1.05] tracking-[-0.035em] text-foreground"
      >
        Local-first by design
      </h2>
      <ul class="mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-4 lg:gap-10">
        <li
          v-for="(item, i) in principles"
          :key="item.title"
          class="border-t border-border pt-5"
          :style="visible ? { transitionDelay: `${80 + i * 70}ms` } : undefined"
        >
          <h3 class="text-[1.0625rem] font-semibold text-foreground">
            {{ item.title }}
          </h3>
          <p class="mt-2 text-[0.9375rem] leading-[1.6] text-muted-foreground">
            {{ item.body }}
          </p>
        </li>
      </ul>
    </div>
  </section>
</template>
