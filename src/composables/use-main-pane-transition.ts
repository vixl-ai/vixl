import { nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { shouldFadeMainPane } from '@/utils/main-pane-key'

type ViewTransitionLike = {
  finished: Promise<void>
  skipTransition?: () => void
}

type DocumentWithViewTransition = Document & {
  startViewTransition: (
    updateCallback: () => void | Promise<void>,
  ) => ViewTransitionLike
}

let installed = false
let navigationEpoch = 0
let transitionInFlight = false
let settleUpdate: (() => void) | null = null
let activeTransition: ViewTransitionLike | null = null

const hasViewTransitionApi = (
  doc: Document,
): doc is DocumentWithViewTransition =>
  typeof (doc as DocumentWithViewTransition).startViewTransition ===
  'function'

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

const releaseUpdate = (): void => {
  const settle = settleUpdate
  settleUpdate = null
  settle?.()
}

const clearInFlight = (): void => {
  activeTransition = null
  transitionInFlight = false
  releaseUpdate()
}

export default (): void => {
  if (installed) {
    return
  }
  installed = true

  const router = useRouter()

  router.beforeEach((to, from) => {
    const epoch = ++navigationEpoch
    const fade = shouldFadeMainPane(from, to, {
      reducedMotion: prefersReducedMotion(),
      hasViewTransition: hasViewTransitionApi(document),
      transitionInFlight,
    })
    if (!fade) {
      if (transitionInFlight) {
        activeTransition?.skipTransition?.()
        clearInFlight()
      }
      return true
    }

    transitionInFlight = true
    return new Promise<boolean>((resolveGuard) => {
      try {
        const transition = (
          document as DocumentWithViewTransition
        ).startViewTransition(() => {
          resolveGuard(true)
          if (epoch !== navigationEpoch) {
            return
          }
          return new Promise<void>((resolve) => {
            settleUpdate = resolve
          })
        })
        activeTransition = transition
        void transition.finished.finally(() => {
          if (activeTransition === transition) {
            clearInFlight()
          }
        })
      } catch {
        transitionInFlight = false
        settleUpdate = null
        resolveGuard(true)
      }
    })
  })

  router.afterEach(() => {
    void nextTick(() => {
      releaseUpdate()
    })
  })

  router.onError(() => {
    activeTransition?.skipTransition?.()
    clearInFlight()
  })
}
