import slugify from 'slugify'
import {
  createStudioInputSchema,
  formatStudioSchemaError,
  type CreateStudioInput,
} from '@/schemas/studio-document'
import { fsWriteFile, getVixlDir } from '@/services/vixl/vixl-tauri'
import validateStudioSlug from '@/services/studio/validate-studio-slug'

type WriteStudioArgs = CreateStudioInput & {
  scope: 'personal' | 'project'
  projectRoot?: string
}

type WriteStudioResult = {
  slug: string
  path: string
}

const formatStudioDocument = (input: {
  title: string
  slug: string
  content: string
  createdAt: string
}): string => {
  const body = input.content.trim()
  return `---
title: ${JSON.stringify(input.title)}
slug: ${JSON.stringify(input.slug)}
createdAt: ${input.createdAt}
---

${body}
`
}

export default async (input: WriteStudioArgs): Promise<WriteStudioResult> => {
  const validated = createStudioInputSchema.safeParse({
    title: input.title,
    slug: input.slug,
    content: input.content,
  })
  if (!validated.success) {
    throw new Error(`Invalid studio input: ${formatStudioSchemaError(validated.error)}`)
  }

  const slug =
    validated.data.slug?.trim() ||
    slugify(validated.data.title, { lower: true, strict: true }) ||
    'untitled'
  const slugError = validateStudioSlug(slug)
  if (slugError) {
    throw new Error(slugError)
  }

  const createdAt = new Date().toISOString()
  const content = formatStudioDocument({
    title: validated.data.title,
    slug,
    content: validated.data.content,
    createdAt,
  })

  // Nested index.md so list_vixl_files (studio) can discover the artifact.
  if (input.scope === 'project') {
    if (!input.projectRoot) {
      throw new Error('projectRoot is required for project-scoped studio documents')
    }
    const path = `.vixl/studio/${slug}/index.md`
    await fsWriteFile({
      projectRoot: input.projectRoot,
      path,
      content,
    })
    return { slug, path }
  }

  const personalDir = await getVixlDir('personal')
  const path = `studio/${slug}/index.md`
  await fsWriteFile({
    projectRoot: personalDir,
    path,
    content,
  })
  return { slug, path }
}
