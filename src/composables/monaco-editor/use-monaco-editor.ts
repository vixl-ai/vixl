import { computed, ref } from 'vue'
import type * as monaco from 'monaco-editor'
import { isTauri } from '@/services/vixl/vixl-tauri'
import useWorkbenchStore from '@/composables/use-workbench-store'
import useLspStatus from '@/composables/use-lsp-status'
import { createHelpers } from './helpers'
import { createLsp } from './lsp'
import { createLspProviders } from './lsp-providers'
import { createModels } from './models'
import { createEditorInstances } from './editor-instances'
import { bindMonacoLifecycle } from './lifecycle'
import type { MonacoEditorContext, MonacoEditorEmit, MonacoEditorProps } from './types'

export default (props: MonacoEditorProps, emit: MonacoEditorEmit) => {
  const workbench = useWorkbenchStore()
  const lspStatus = useLspStatus()
  const containerRef = ref<HTMLDivElement | null>(null)
  const saving = ref(false)

  const lspActive = computed(() => isTauri())
  const lineNumbersOption = computed((): 'on' | 'off' =>
    props.lineNumbers !== false ? 'on' : 'off',
  )
  const wordWrapOption = computed((): 'on' | 'off' =>
    props.wordWrap === true ? 'on' : 'off',
  )
  const projectRoot = computed(
    () => workbench.getProject(props.projectId)?.rootPath ?? null,
  )

  const ctx: MonacoEditorContext = {
    props,
    emit,
    workbench,
    lspStatus,
    containerRef,
    saving,
    editor: null,
    diffEditor: null,
    editorInitializing: false,
    resizeObserver: null,
    lspProviderDisposables: [],
    unlistenDiagnostics: null,
    stopThemeObserver: null,
    lspProvidersRegistered: false,
    models: new Map<string, monaco.editor.ITextModel>(),
    originalModels: new Map<string, monaco.editor.ITextModel>(),
    pathByModel: new Map(),
    lspServerByPath: new Map(),
    dirtyByPath: new Map(),
    lastLspContentByPath: new Map(),
    lspActive,
    lineNumbersOption,
    wordWrapOption,
    projectRoot,
  }

  const helpers = createHelpers(ctx)
  const lsp = createLsp(ctx)
  const { registerLspProviders } = createLspProviders(ctx, lsp)

  const attachModelRef: { current: ((path: string) => Promise<void>) | null } = {
    current: null,
  }
  const models = createModels(ctx, { helpers, lsp, attachModelRef })

  const saveRef: { current: ((targetPath?: string) => Promise<boolean>) | null } = {
    current: null,
  }
  const editors = createEditorInstances(ctx, {
    helpers,
    models,
    save: (targetPath) => {
      if (!saveRef.current) {
        return Promise.resolve(false)
      }
      return saveRef.current(targetPath)
    },
  })
  saveRef.current = models.save

  bindMonacoLifecycle(ctx, {
    helpers,
    lsp,
    models,
    editors,
    registerLspProviders,
  })

  return {
    containerRef,
    save: models.save,
    isPathDirty: helpers.isPathDirty,
  }
}
