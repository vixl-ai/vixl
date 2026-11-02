import { ref } from 'vue'

export const revealedProjectSlug = ref<string | null>(null)
export const revealedProjectNonce = ref(0)

export const revealFleetProject = (slug: string): void => {
  revealedProjectNonce.value += 1
  revealedProjectSlug.value = slug
}

export const clearRevealedFleetProject = (slug: string): void => {
  if (revealedProjectSlug.value === slug) {
    revealedProjectSlug.value = null
  }
}
