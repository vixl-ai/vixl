import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export function useReveal(options?: { rootMargin?: string; threshold?: number }) {
  const el: Ref<HTMLElement | null> = ref(null)
  // Keep content visible by default (SSR, SEO, full-page screenshots).
  // Only animate when the element starts below the fold.
  const visible = ref(true)

  let observer: IntersectionObserver | null = null
  let safety: ReturnType<typeof setTimeout> | null = null

  onMounted(() => {
    if (typeof window === 'undefined' || !el.value) return

    const reduce =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    if (reduce) return

    const rect = el.value.getBoundingClientRect()
    const alreadyInView = rect.top < window.innerHeight * 0.92 && rect.bottom > 40
    if (alreadyInView) return

    visible.value = false

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            visible.value = true
            observer?.disconnect()
            observer = null
            break
          }
        }
      },
      {
        rootMargin: options?.rootMargin ?? '0px 0px -4% 0px',
        threshold: options?.threshold ?? 0.05,
      },
    )

    observer.observe(el.value)

    // Never leave content permanently hidden if IO fails.
    safety = setTimeout(() => {
      visible.value = true
    }, 2500)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    observer = null
    if (safety) clearTimeout(safety)
  })

  return { el, visible }
}
