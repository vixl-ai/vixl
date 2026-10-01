import { ref } from 'vue'
import type { LspCatalogEntry } from '@/services/vixl/vixl-tauri'
import type { LspDiagnostic } from '@/utils/monaco-lsp'

export const servers = ref<Map<string, LspCatalogEntry>>(new Map())
export const installMessage = ref<string | null>(null)
export const prefetchBusy = ref(false)
export const warming = ref(false)
export const diagnosticsByUri = ref<Map<string, LspDiagnostic[]>>(new Map())

export const listenerState = {
  bound: false,
  unlistenInstall: null as (() => void) | null,
  unlistenState: null as (() => void) | null,
  unlistenDiagnostics: null as (() => void) | null,
}

export const warmState = {
  lastWarmedRoot: null as string | null,
}

export const toastedFailureKeys = new Set<string>()
