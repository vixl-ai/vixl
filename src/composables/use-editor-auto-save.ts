import {
  onBeforeUnmount,
  watch,
  type Ref,
} from 'vue'

type EditorAutoSaveFn = (
  targetPath?: string,
  options?: { silent?: boolean },
) => Promise<boolean>

const DEFAULT_DELAY_MS = 1000

export default (options: {
  autoSave: Readonly<Ref<boolean>>
  selectedPath: Readonly<Ref<string>>
  diffView: Readonly<Ref<boolean>>
  isDirty: (path: string) => boolean
  save: EditorAutoSaveFn
  delayMs?: number
}) => {
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS
  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingPath: string | null = null
  let pausedPath: string | null = null
  let inFlight: Promise<void> | null = null

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  const cancelPending = (path?: string): void => {
    if (path !== undefined && pendingPath !== path) {
      return
    }
    clearTimer()
    pendingPath = null
  }

  const canSavePath = (path: string): boolean =>
    options.autoSave.value
    && !options.diffView.value
    && options.isDirty(path)
    && pausedPath !== path

  const flushPending = async (): Promise<void> => {
    clearTimer()
    const path = pendingPath
    pendingPath = null
    if (!path || !canSavePath(path)) {
      return
    }

    const run = (async () => {
      const saved = await options.save(path, { silent: true })
      if (!saved && canSavePath(path)) {
        schedule(path)
      }
    })()

    inFlight = run
    try {
      await run
    } finally {
      if (inFlight === run) {
        inFlight = null
      }
    }
  }

  const schedule = (path: string): void => {
    if (
      !options.autoSave.value
      || options.diffView.value
      || !path
      || pausedPath === path
    ) {
      return
    }
    clearTimer()
    pendingPath = path
    timer = setTimeout(() => {
      void flushPending()
    }, delayMs)
  }

  const pausePath = (path: string): void => {
    cancelPending(path)
    pausedPath = path
  }

  const resumePath = (path: string): void => {
    if (pausedPath === path) {
      pausedPath = null
    }
    if (canSavePath(path)) {
      schedule(path)
    }
  }

  const settle = async (): Promise<void> => {
    if (inFlight) {
      await inFlight
    }
  }

  const onDirtyChange = (payload: { path: string; dirty: boolean }): void => {
    if (!payload.dirty) {
      cancelPending(payload.path)
      return
    }
    if (payload.path === options.selectedPath.value) {
      schedule(payload.path)
    }
  }

  watch(
    () => options.autoSave.value,
    (enabled) => {
      if (!enabled) {
        cancelPending()
        return
      }
      const path = options.selectedPath.value
      if (path && canSavePath(path)) {
        schedule(path)
      }
    },
  )

  watch(
    () => options.diffView.value,
    (isDiff) => {
      if (isDiff) {
        cancelPending()
      }
    },
  )

  watch(
    () => options.selectedPath.value,
    (_next, prev) => {
      if (prev) {
        void flushPending()
      }
    },
  )

  onBeforeUnmount(() => {
    clearTimer()
    const path = pendingPath
    pendingPath = null
    if (path && canSavePath(path)) {
      void options.save(path, { silent: true })
    }
  })

  return {
    onDirtyChange,
    pausePath,
    resumePath,
    settle,
  }
}
