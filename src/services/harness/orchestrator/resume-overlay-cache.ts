import type { ModelMessage } from 'ai'

const itemsByChat = new Map<
  string,
  Array<
    | { kind: 'spawn'; id: string; messages: ModelMessage[] }
    | {
        kind: 'wake'
        id: string
        content: string
        toolCallIds: string[]
        resultKeys: string[]
      }
  >
>()

export default itemsByChat
