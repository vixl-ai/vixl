<script setup lang="ts">
const mindsLight = '/media/sponsors/minds-light.png'
const mindsDark = '/media/sponsors/minds-dark.png'
const nicheLight = '/media/sponsors/niche-light.webp'
const nicheDark = '/media/sponsors/niche-dark.png'
</script>

<template>
  <section
    class="vx-sponsors relative"
    aria-labelledby="sponsors-caption"
  >
    <div class="vx-container">
      <p
        id="sponsors-caption"
        class="vx-sponsors-caption text-center text-[1rem] font-medium text-muted-foreground"
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
            decoding="async"
          >
          <img
            :src="mindsDark"
            alt="Minds"
            width="116"
            height="54"
            class="vx-sponsor-logo vx-sponsor-logo--minds hidden dark:block"
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
            width="1592"
            height="597"
            class="vx-sponsor-logo vx-sponsor-logo--niche dark:hidden"
            decoding="async"
          >
          <img
            :src="nicheDark"
            alt="Niche"
            width="500"
            height="187"
            class="vx-sponsor-logo vx-sponsor-logo--niche hidden dark:block"
            decoding="async"
          >
        </a>
      </div>
    </div>
  </section>
</template>
