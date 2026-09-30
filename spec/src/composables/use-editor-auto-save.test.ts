import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick, ref } from 'vue'
import { mount, type VueWrapper } from '@vue/test-utils'

const flush = async (): Promise<void> => {
  await nextTick()
  await Promise.resolve()
}

type AutoSaveApi = {
  onDirtyChange: (payload: { path: string; dirty: boolean }) => void
  pausePath: (path: string) => void
  resumePath: (path: string) => void
  settle: () => Promise<void>
}

describe('useEditorAutoSave', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
    vi.resetModules()
  })

  const mountAutoSave = async (overrides?: {
    autoSave?: boolean
    selectedPath?: string
    diffView?: boolean
    dirty?: Record<string, boolean>
    delayMs?: number
  }) => {
    const { default: useEditorAutoSave } = await import(
      '@/composables/use-editor-auto-save'
    )

    const autoSave = ref(overrides?.autoSave ?? true)
    const selectedPath = ref(overrides?.selectedPath ?? 'src/a.ts')
    const diffView = ref(overrides?.diffView ?? false)
    const dirty = ref<Record<string, boolean>>(overrides?.dirty ?? {})
    const save = vi.fn<
      (targetPath?: string, options?: { silent?: boolean }) => Promise<boolean>
    >(async () => true)
    const apiBox: { current: AutoSaveApi | null } = { current: null }

    const Host = defineComponent({
      setup() {
        apiBox.current = useEditorAutoSave({
          autoSave,
          selectedPath,
          diffView,
          isDirty: (path) => dirty.value[path] === true,
          save,
          delayMs: overrides?.delayMs ?? 1000,
        })
        return {}
      },
      template: '<div />',
    })

    wrapper = mount(Host)
    await flush()

    const api = apiBox.current
    if (!api) {
      throw new Error('useEditorAutoSave did not initialize')
    }

    return {
      autoSave,
      selectedPath,
      diffView,
      dirty,
      save,
      ...api,
    }
  }

  it('debounces a silent save for the dirty active path', async () => {
    const harness = await mountAutoSave()
    harness.dirty.value = { 'src/a.ts': true }

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    expect(harness.save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(999)
    expect(harness.save).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(harness.save).toHaveBeenCalledTimes(1)
    expect(harness.save).toHaveBeenCalledWith('src/a.ts', { silent: true })
  })

  it('does not save while autoSave is off', async () => {
    const harness = await mountAutoSave({ autoSave: false })
    harness.dirty.value = { 'src/a.ts': true }

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    await vi.advanceTimersByTimeAsync(1000)

    expect(harness.save).not.toHaveBeenCalled()
  })

  it('does not auto-save in diff view', async () => {
    const harness = await mountAutoSave({ diffView: true })
    harness.dirty.value = { 'src/a.ts': true }

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    await vi.advanceTimersByTimeAsync(1000)

    expect(harness.save).not.toHaveBeenCalled()
  })

  it('cancels a pending save when the path becomes clean', async () => {
    const harness = await mountAutoSave()
    harness.dirty.value = { 'src/a.ts': true }

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    harness.dirty.value = { 'src/a.ts': false }
    harness.onDirtyChange({ path: 'src/a.ts', dirty: false })

    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.save).not.toHaveBeenCalled()
  })

  it('skips fire when dirty was cleared before the timer runs', async () => {
    const harness = await mountAutoSave()
    harness.dirty.value = { 'src/a.ts': true }

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    harness.dirty.value = { 'src/a.ts': false }

    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.save).not.toHaveBeenCalled()
  })

  it('flushes the previous path when switching files', async () => {
    const harness = await mountAutoSave()
    harness.dirty.value = { 'src/a.ts': true }

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    harness.selectedPath.value = 'src/b.ts'
    await flush()

    expect(harness.save).toHaveBeenCalledTimes(1)
    expect(harness.save).toHaveBeenCalledWith('src/a.ts', { silent: true })
  })

  it('schedules a save when autoSave is turned on while dirty', async () => {
    const harness = await mountAutoSave({ autoSave: false })
    harness.dirty.value = { 'src/a.ts': true }

    harness.autoSave.value = true
    await flush()
    await vi.advanceTimersByTimeAsync(1000)

    expect(harness.save).toHaveBeenCalledTimes(1)
    expect(harness.save).toHaveBeenCalledWith('src/a.ts', { silent: true })
  })

  it('reschedules when save is skipped while still dirty', async () => {
    const harness = await mountAutoSave()
    harness.dirty.value = { 'src/a.ts': true }
    harness.save
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.save).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.save).toHaveBeenCalledTimes(2)
    expect(harness.save).toHaveBeenNthCalledWith(2, 'src/a.ts', { silent: true })
  })

  it('attempts one silent save on unmount and does not reschedule', async () => {
    const harness = await mountAutoSave()
    harness.dirty.value = { 'src/a.ts': true }
    harness.save.mockResolvedValue(false)

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    wrapper!.unmount()
    wrapper = null
    await flush()

    expect(harness.save).toHaveBeenCalledTimes(1)
    expect(harness.save).toHaveBeenCalledWith('src/a.ts', { silent: true })

    await vi.advanceTimersByTimeAsync(2000)
    expect(harness.save).toHaveBeenCalledTimes(1)
  })

  it('cancels pending and blocks scheduling while a path is paused', async () => {
    const harness = await mountAutoSave()
    harness.dirty.value = { 'src/a.ts': true }

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    harness.pausePath('src/a.ts')

    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.save).not.toHaveBeenCalled()

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.save).not.toHaveBeenCalled()
  })

  it('reschedules a dirty paused path when resumed', async () => {
    const harness = await mountAutoSave()
    harness.dirty.value = { 'src/a.ts': true }

    harness.pausePath('src/a.ts')
    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.save).not.toHaveBeenCalled()

    harness.resumePath('src/a.ts')
    await vi.advanceTimersByTimeAsync(1000)

    expect(harness.save).toHaveBeenCalledTimes(1)
    expect(harness.save).toHaveBeenCalledWith('src/a.ts', { silent: true })
  })

  it('does not reschedule on resume when the path is clean', async () => {
    const harness = await mountAutoSave()
    harness.dirty.value = { 'src/a.ts': true }

    harness.pausePath('src/a.ts')
    harness.dirty.value = { 'src/a.ts': false }
    harness.resumePath('src/a.ts')

    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.save).not.toHaveBeenCalled()
  })

  it('settle waits for an in-flight save started before pause', async () => {
    const harness = await mountAutoSave()
    harness.dirty.value = { 'src/a.ts': true }

    let resolveSave!: (value: boolean) => void
    harness.save.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSave = resolve
        }),
    )

    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.save).toHaveBeenCalledTimes(1)

    harness.pausePath('src/a.ts')
    const settling = harness.settle()

    harness.dirty.value = { 'src/a.ts': false }
    resolveSave(true)
    await settling

    expect(harness.dirty.value['src/a.ts']).toBe(false)
    harness.onDirtyChange({ path: 'src/a.ts', dirty: true })
    harness.dirty.value = { 'src/a.ts': true }
    await vi.advanceTimersByTimeAsync(1000)
    expect(harness.save).toHaveBeenCalledTimes(1)
  })
})
