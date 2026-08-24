import {
  createSkillInputSchema,
  type CreateSkillInput,
} from '@/schemas/skills/skill-document'
import { fsWriteFile, getVixlDir } from '@/services/vixl/vixl-tauri'
import slugifyName from '@/utils/slugify-name'

type WriteSkillArgs = CreateSkillInput & {
  scope: 'personal' | 'project'
  projectRoot?: string
}

type WriteSkillResult = {
  slug: string
  path: string
}

const formatSkillDocument = (input: CreateSkillInput): string => {
  const body = input.body.trim()
  return `---
name: ${JSON.stringify(input.name)}
description: ${JSON.stringify(input.description)}
---

${body}
`
}

export default async (input: WriteSkillArgs): Promise<WriteSkillResult> => {
  const validated = createSkillInputSchema.safeParse({
    name: input.name,
    description: input.description,
    body: input.body,
  })
  if (!validated.success) {
    throw new Error(
      `Invalid skill input: ${validated.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    )
  }

  const slug = slugifyName(validated.data.name)
  if (input.scope === 'project') {
    if (!input.projectRoot) {
      throw new Error('projectRoot is required for project-scoped skills')
    }
    const path = `.vixl/skills/${slug}/SKILL.md`
    await fsWriteFile({
      projectRoot: input.projectRoot,
      path,
      content: formatSkillDocument(validated.data),
    })
    return { slug, path }
  }

  const personalDir = await getVixlDir('personal')
  const path = `skills/${slug}/SKILL.md`
  await fsWriteFile({
    projectRoot: personalDir,
    path,
    content: formatSkillDocument(validated.data),
  })
  return { slug, path }
}
