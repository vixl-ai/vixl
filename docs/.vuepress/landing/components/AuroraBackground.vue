<script setup lang="ts">
withDefaults(
  defineProps<{
    intensity?: 'hero' | 'soft'
  }>(),
  {
    intensity: 'hero',
  },
)
</script>

<template>
  <div
    class="vx-aurora pointer-events-none absolute inset-0"
    :data-intensity="intensity"
    aria-hidden="true"
  >
    <div class="vx-aurora-wash" />
    <div class="vx-aurora-orb vx-aurora-orb--a" />
    <div class="vx-aurora-orb vx-aurora-orb--b" />
    <div class="vx-aurora-orb vx-aurora-orb--c" />
    <div class="vx-aurora-orb vx-aurora-orb--d" />
    <div class="vx-aurora-noise" />
  </div>
</template>
