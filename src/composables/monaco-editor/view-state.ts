import * as monaco from 'monaco-editor'
import { toast } from 'vue-sonner'
import { useThrottleFn } from '@vueuse/core'
import {
  editorLoadViewState,
  editorSaveViewState,
  isTauri,
} from '@/services/vixl/vixl-tauri'
import formatMonacoError from '@/utils/format-monaco-error'
import type { MonacoEditorContext } from './types'

const VIEW_STATE_THROTTLE_MS = 300

const persistViewState = async (
  ctx: MonacoEditorContext,
  path: string,
): Promise<void> => {
  if (!isTauri() || ctx.props.diffView || !ctx.editor) {
    return
  }
  const viewState = ctx.editor.saveViewState()
  if (!viewState) {
    return
  }
  try {
    await editorSaveViewState(ctx.props.projectId, path, viewState)
  } catch (error) {
    toast.error('Failed to save editor position', {
      description: formatMonacoError(error),
    })
  }
}

export const saveEditorViewState = async (
  ctx: MonacoEditorContext,
  path: string | null | undefined,
): Promise<void> => {
  if (!path) {
    return
  }
  await persistViewState(ctx, path)
}

export const restoreEditorViewState = async (
  ctx: MonacoEditorContext,
  path: string,
): Promise<void> => {
  if (!isTauri() || ctx.props.diffView || !ctx.editor) {
    return
  }
  try {
    const viewState = await editorLoadViewState(ctx.props.projectId, path)
    if (!viewState || ctx.props.path !== path || !ctx.editor) {
      return
    }
    ctx.editor.restoreViewState(viewState as monaco.editor.ICodeEditorViewState)
  } catch (error) {
    toast.error('Failed to restore editor position', {
      description: formatMonacoError(error),
    })
  }
}

export const bindEditorViewStateListeners = (
  ctx: MonacoEditorContext,
): void => {
  if (!ctx.editor) {
    return
  }

  const saveCurrent = useThrottleFn(() => {
    const path = ctx.props.path
    if (!path) {
      return
    }
    persistViewState(ctx, path).catch((error: unknown) => {
      toast.error('Failed to save editor position', {
        description: formatMonacoError(error),
      })
    })
  }, VIEW_STATE_THROTTLE_MS)

  const onCursor = ctx.editor.onDidChangeCursorPosition(() => {
    saveCurrent()
  })
  const onScroll = ctx.editor.onDidScrollChange(() => {
    saveCurrent()
  })
  const onBlur = ctx.editor.onDidBlurEditorWidget(() => {
    const path = ctx.props.path
    if (!path) {
      return
    }
    persistViewState(ctx, path).catch((error: unknown) => {
      toast.error('Failed to save editor position', {
        description: formatMonacoError(error),
      })
    })
  })

  ctx.viewStateDisposables.push(onCursor, onScroll, onBlur)
}

export const disposeEditorViewStateListeners = (
  ctx: MonacoEditorContext,
): void => {
  for (const disposable of ctx.viewStateDisposables) {
    disposable.dispose()
  }
  ctx.viewStateDisposables = []
}
