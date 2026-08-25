import * as monaco from 'monaco-editor'
import {
  isGitHeadModel,
  workingFileUri,
} from '@/utils/monaco-working-uri'

export default (
  projectId: string | null,
  path: string,
): monaco.editor.ITextModel | null => {
  if (!projectId) {
    return null
  }
  const model = monaco.editor.getModel(workingFileUri(projectId, path))
  if (!model || isGitHeadModel(model)) {
    return null
  }
  return model
}
