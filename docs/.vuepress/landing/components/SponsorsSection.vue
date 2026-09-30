<script setup lang="ts">
const mindsLight = '/media/sponsors/minds-light.webp'
const mindsDark = '/media/sponsors/minds-dark.webp'
const nicheLight = '/media/sponsors/niche-light.webp'
const nicheDark = '/media/sponsors/niche-dark.webp'
</script>

<template>
  <section
    class="vx-sponsors relative"
    aria-labelledby="sponsors-caption"
  >
    <div class="vx-container">
      <p
        id="sponsors-caption"
        class="vx-sponsors-caption text-center text-[1.25rem] font-medium tracking-[-0.01em] lg:text-[1.5rem] text-muted-foreground"
      >
        Sponsored by
      </p>
      <div
        class="vx-sponsors-row mt-6 flex flex-wrap items-center justify-center"
      >
        <a
          href="https://getminds.ai/"
          target="_blank"
          rel="noopener"
          class="vx-sponsor-link inline-flex items-center opacity-85 transition-opacity hover:opacity-100"
        >
          <img
            :src="mindsLight"
            alt="Minds"
            width="116"
            height="54"
            class="vx-sponsor-logo vx-sponsor-logo--minds dark:hidden"
            loading="lazy"
            decoding="async"
          >
          <img
            :src="mindsDark"
            alt="Minds"
            width="116"
            height="54"
            class="vx-sponsor-logo vx-sponsor-logo--minds hidden dark:block"
            loading="lazy"
            decoding="async"
          >
        </a>
        <a
          href="https://www.getniche.ai/"
          target="_blank"
          rel="noopener"
          class="vx-sponsor-link inline-flex items-center opacity-85 transition-opacity hover:opacity-100"
        >
          <img
            :src="nicheLight"
            alt="Niche"
            width="256"
            height="96"
            class="vx-sponsor-logo vx-sponsor-logo--niche dark:hidden"
            loading="lazy"
            decoding="async"
          >
          <img
            :src="nicheDark"
            alt="Niche"
            width="257"
            height="96"
            class="vx-sponsor-logo vx-sponsor-logo--niche hidden dark:block"
            loading="lazy"
            decoding="async"
          >
        </a>
      </div>
    </div>
  </section>
</template>
