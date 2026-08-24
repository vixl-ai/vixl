import { createRuleInputSchema, type CreateRuleInput } from '@/schemas/rules/rule-document'
import { fsWriteFile, getVixlDir } from '@/services/vixl/vixl-tauri'
import slugifyName from '@/utils/slugify-name'

type WriteRuleArgs = CreateRuleInput & {
  scope: 'personal' | 'project'
  projectRoot?: string
}

type WriteRuleResult = {
  slug: string
  path: string
}

export default async (input: WriteRuleArgs): Promise<WriteRuleResult> => {
  const validated = createRuleInputSchema.safeParse({
    name: input.name,
    body: input.body,
  })
  if (!validated.success) {
    throw new Error(
      `Invalid rule input: ${validated.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    )
  }

  const slug = slugifyName(validated.data.name)
  // Rules are freeform markdown; loaders include the full file body in the prompt.
  if (input.scope === 'project') {
    if (!input.projectRoot) {
      throw new Error('projectRoot is required for project-scoped rules')
    }
    const path = `.vixl/rules/${slug}.md`
    await fsWriteFile({
      projectRoot: input.projectRoot,
      path,
      content: `${validated.data.body.trim()}\n`,
    })
    return { slug, path }
  }

  const personalDir = await getVixlDir('personal')
  const path = `rules/${slug}.md`
  await fsWriteFile({
    projectRoot: personalDir,
    path,
    content: `${validated.data.body.trim()}\n`,
  })
  return { slug, path }
}
