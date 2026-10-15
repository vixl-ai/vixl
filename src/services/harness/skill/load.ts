import { tool } from 'ai'
import { z } from 'zod'
import { loadSkillForWorkspace } from '@/services/harness/skill/resolve-member-skill'
import type { HarnessToolContext } from '@/types/harness/tool-context'

const loadSkillTool = (ctx: HarnessToolContext) =>
  tool({
    description: 'Load the full instructions for a skill by name',
    inputSchema: z.object({ name: z.string().describe('Skill name') }),
    execute: async ({ name }) => {
      const result = await loadSkillForWorkspace(name, ctx.projectRoot, ctx.members)
      if ('error' in result) {
        return result
      }
      return {
        name: result.name,
        skillDirectory: result.skillDirectory,
        content: result.content,
        truncated: result.truncated,
      }
    },
  })

export default loadSkillTool
