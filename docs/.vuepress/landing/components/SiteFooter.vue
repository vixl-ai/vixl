<script setup lang="ts">
import { githubRepo, licenseUrl, releasesUrl } from '@landing/data/features'
</script>

<template>
  <footer class="vx-footer border-t border-border bg-background py-10">
    <div
      class="vx-container flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between"
    >
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.875rem] text-muted-foreground">
        <span class="font-medium text-foreground">Vixl</span>
        <a
          class="transition-colors hover:text-foreground"
          :href="licenseUrl"
          target="_blank"
          rel="noopener noreferrer"
        >MIT License</a>
      </div>
      <nav
        class="flex flex-wrap gap-x-5 gap-y-2 text-[0.875rem] text-muted-foreground"
        aria-label="Footer"
      >
        <a class="transition-colors hover:text-foreground" href="/getting-started/">Docs</a>
        <a
          class="transition-colors hover:text-foreground"
          :href="releasesUrl"
        >Releases</a>
        <a
          class="transition-colors hover:text-foreground"
          :href="githubRepo"
          target="_blank"
          rel="noopener noreferrer"
        >GitHub</a>
        <a
          class="transition-colors hover:text-foreground"
          href="/resources/privacy"
        >Privacy</a>
        <a
          class="transition-colors hover:text-foreground"
          href="/resources/roadmap"
        >Roadmap</a>
      </nav>
    </div>
  </footer>
</template>
