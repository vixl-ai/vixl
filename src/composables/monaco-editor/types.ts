import type { ComputedRef, Ref } from 'vue'
import type * as monaco from 'monaco-editor'
import type useWorkbenchStore from '@/composables/use-workbench-store'
import type useLspStatus from '@/composables/use-lsp-status'

export type MonacoEditorProps = {
  projectId: string
  path: string | null
  openPaths?: string[]
  lineNumbers?: boolean
  wordWrap?: boolean
  diffView?: boolean
}

export type MonacoEditorEmit = {
  (event: 'dirty-change', payload: { path: string; dirty: boolean }): void
  (event: 'saved', payload: { path: string; content: string }): void
}

export type LspDiagnosticsEvent = {
  uri: string
  diagnostics: unknown
  serverId: string
}

export type MonacoEditorContext = {
  props: MonacoEditorProps
  emit: MonacoEditorEmit
  workbench: ReturnType<typeof useWorkbenchStore>
  lspStatus: ReturnType<typeof useLspStatus>
  containerRef: Ref<HTMLDivElement | null>
  saving: Ref<boolean>
  editor: monaco.editor.IStandaloneCodeEditor | null
  diffEditor: monaco.editor.IStandaloneDiffEditor | null
  editorInitializing: boolean
  resizeObserver: ResizeObserver | null
  lspProviderDisposables: monaco.IDisposable[]
  unlistenDiagnostics: (() => void) | null
  stopThemeObserver: (() => void) | null
  lspProvidersRegistered: boolean
  viewStateDisposables: monaco.IDisposable[]
  models: Map<string, monaco.editor.ITextModel>
  originalModels: Map<string, monaco.editor.ITextModel>
  pathByModel: Map<monaco.editor.ITextModel, string>
  lspServerByPath: Map<string, string>
  dirtyByPath: Map<string, boolean>
  lastLspContentByPath: Map<string, string>
  lspActive: ComputedRef<boolean>
  lineNumbersOption: ComputedRef<'on' | 'off'>
  wordWrapOption: ComputedRef<'on' | 'off'>
  projectRoot: ComputedRef<string | null>
}
