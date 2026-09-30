<script setup lang="ts">
import { computed } from 'vue'
import { splitMonoPaths } from '@landing/lib/monoPaths'

const props = defineProps<{
  text: string
}>()

const parts = computed(() => splitMonoPaths(props.text))
</script>

<template>
  <template v-for="(part, i) in parts" :key="i">
    <span v-if="part.mono" class="vx-mono">{{ part.text }}</span>
    <template v-else>{{ part.text }}</template>
  </template>
</template>
