import { tool } from 'ai'
import { z } from 'zod'
import { readTerminalOutput } from '@/services/harness/shell/run-command'

const terminalOutput = () =>
  tool({
    description:
      'Read output from a background shell before exit; block waits in the current turn, and that shell does not also wake the parent',
    inputSchema: z.object({
      shell_id: z.string().describe('shell_id from run_terminal is_background'),
      block: z.boolean().optional().describe('Wait until the shell exits'),
      tail: z.number().optional().describe('Max trailing lines to return'),
    }),
    execute: async ({ shell_id, block, tail }) => readTerminalOutput(shell_id, block, tail),
  })

export default terminalOutput
