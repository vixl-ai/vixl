import { writeTempHandoff } from '@/services/vixl/vixl-tauri'

export type WriteHandoffInput = {
  summary: string
  chatId: string
}

export type WriteHandoffResult = {
  path: string
  filename: string
}

export default async (input: WriteHandoffInput): Promise<WriteHandoffResult> => {
  const { summary, chatId } = input

  const content = [
    `# Handoff: ${new Date().toLocaleString()}`,
    '',
    `**Source chat:** ${chatId}`,
    '',
    '## Summary',
    '',
    summary,
  ].join('\n')

  return writeTempHandoff({ content })
}
