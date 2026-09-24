/**
 * Seed the lesson "ייצוג אלגברי של קו ישר — מבוא" into the geometry
 * chapter of the "הכנה לכיתה ז (TEST)" course.
 *
 * Creates 9 content pages, 12 exercises, and the lesson document with
 * an ordered `blocks` playlist referencing them. Idempotent — if the
 * lesson already exists by slug, the script exits without changes.
 *
 * Usage: npx tsx scripts/seed-algebraic-line-intro-lesson.ts
 */
import { getPayload } from 'payload'
import config from '@payload-config'

import {
  ALGEBRAIC_LINE_INTRO_LESSON,
  getAlgebraicLineIntroBlocksTemplate,
  getAlgebraicLineIntroContentPages,
  getAlgebraicLineIntroExercises,
} from '@/server/payload/endpoints/seed/algebraic-line-intro-lesson'
import { getDefaultTenantSlug } from '@/server/repos/tenant/get-default-tenant'

type BlockTemplate = {
  id: string
  blockType: 'exerciseRef' | 'contentPageRef'
  exercise?: string
  contentPage?: string
}

function parseBlocksTemplate(raw: string): BlockTemplate[] {
  const parsed: unknown = JSON.parse(raw)
  if (!Array.isArray(parsed)) {
    throw new Error('Blocks template is not an array')
  }
  return parsed as BlockTemplate[]
}

function generateBlockId(): string {
  return Math.random().toString(36).slice(2, 14)
}

async function ensureDefaultTenant(payload: Awaited<ReturnType<typeof getPayload>>) {
  const slug = getDefaultTenantSlug()
  const existing = await payload.find({
    collection: 'tenants',
    where: { slug: { equals: slug } },
    limit: 1,
    overrideAccess: true,
  })
  if (existing.docs[0]) return existing.docs[0]
  return payload.create({
    collection: 'tenants',
    data: { name: slug, slug, status: 'active' },
    overrideAccess: true,
  })
}

async function main() {
  const payload = await getPayload({ config })
  payload.logger.info('Algebraic line intro seed: starting')

  const tenant = await ensureDefaultTenant(payload)

  // Verify chapter + course exist before creating anything.
  const chapter = await payload
    .findByID({
      collection: 'chapters',
      id: ALGEBRAIC_LINE_INTRO_LESSON.chapterId,
      overrideAccess: true,
    })
    .catch(() => null)
  if (!chapter) {
    throw new Error(
      `Chapter ${ALGEBRAIC_LINE_INTRO_LESSON.chapterId} not found. ` +
        `Cannot seed the lesson without its parent chapter.`,
    )
  }

  const course = await payload
    .findByID({
      collection: 'courses',
      id: ALGEBRAIC_LINE_INTRO_LESSON.courseId,
      overrideAccess: true,
    })
    .catch(() => null)
  if (!course) {
    throw new Error(
      `Course ${ALGEBRAIC_LINE_INTRO_LESSON.courseId} not found. ` +
        `Cannot seed the lesson without its parent course.`,
    )
  }

  // Idempotency: exit if a lesson with this slug already exists.
  const existingLesson = await payload.find({
    collection: 'lessons',
    where: { slug: { equals: ALGEBRAIC_LINE_INTRO_LESSON.slug } },
    limit: 1,
    overrideAccess: true,
  })
  if (existingLesson.docs.length > 0) {
    payload.logger.info(
      `Lesson "${ALGEBRAIC_LINE_INTRO_LESSON.slug}" already exists (id: ${existingLesson.docs[0].id}). Skipping.`,
    )
    process.exit(0)
  }

  // Create the lesson shell first so exercises + content pages can
  // reference it. We'll patch its `blocks` playlist after we know the
  // IDs of the child documents.
  const lesson = await payload.create({
    collection: 'lessons',
    data: {
      title: ALGEBRAIC_LINE_INTRO_LESSON.title,
      slug: ALGEBRAIC_LINE_INTRO_LESSON.slug,
      chapter: chapter.id,
      type: 'learning',
      order: ALGEBRAIC_LINE_INTRO_LESSON.order,
      status: 'draft',
      isActive: true,
      locale: 'he',
      accessType: 'free',
      visibleRenderers: ['interactive'],
      description: ALGEBRAIC_LINE_INTRO_LESSON.description,
      topic: 'Mathematics',
      tenant: tenant.id,
      contentStatus: 'none',
      contentStatusVisible: true,
      blocks: '[]',
    },
    overrideAccess: true,
    draft: false,
  })
  payload.logger.info(`Created lesson shell (id: ${lesson.id})`)

  // Create the 9 content pages and capture their IDs by key.
  const contentPageIds: Record<string, string> = {}
  for (const page of getAlgebraicLineIntroContentPages()) {
    const created = await payload.create({
      collection: 'content-pages',
      data: {
        title: page.title,
        lesson: lesson.id,
        body: page.body,
        status: 'draft',
        isActive: true,
        tenant: tenant.id,
      },
      overrideAccess: true,
    })
    contentPageIds[page.key] = created.id
    payload.logger.info(`Created content page "${page.key}" (id: ${created.id})`)
  }

  // Create the 12 exercises and capture their IDs by key.
  const exerciseIds: Record<string, string> = {}
  for (const exercise of getAlgebraicLineIntroExercises()) {
    const created = await payload.create({
      collection: 'exercises',
      data: {
        title: exercise.title,
        lesson: lesson.id,
        content: { blocks: exercise.contentBlocks },
        origin: 'manual',
        tenant: tenant.id,
        locale: 'he',
        // Pass empty contentHash so a subsequent import doesn't treat
        // this seed exercise as a duplicate of itself.
        contentHash: '',
        specVersion: '1.0',
      },
      overrideAccess: true,
    })
    exerciseIds[exercise.key] = created.id
    payload.logger.info(`Created exercise "${exercise.key}" (id: ${created.id})`)
  }

  // Build the final blocks playlist by substituting the placeholder
  // keys with real content-page / exercise IDs. Each block also gets
  // a freshly generated id so the LessonBlocksField UI treats them as
  // user-editable rather than seed-managed.
  const templateBlocks = parseBlocksTemplate(getAlgebraicLineIntroBlocksTemplate())
  const finalBlocks = templateBlocks.map((block) => {
    const id = generateBlockId()
    if (block.blockType === 'exerciseRef') {
      const key = block.exercise?.replace('__EXERCISE_', '').replace('__', '')
      const exerciseId = key ? exerciseIds[key] : undefined
      if (!exerciseId) {
        throw new Error(`Missing exercise for key "${key}" while building lesson blocks`)
      }
      return { id, blockType: 'exerciseRef' as const, exercise: exerciseId }
    }
    const key = block.contentPage?.replace('__CONTENT_PAGE_', '').replace('__', '')
    const contentPageId = key ? contentPageIds[key] : undefined
    if (!contentPageId) {
      throw new Error(`Missing content page for key "${key}" while building lesson blocks`)
    }
    return { id, blockType: 'contentPageRef' as const, contentPage: contentPageId }
  })

  await payload.update({
    collection: 'lessons',
    id: lesson.id,
    data: { blocks: JSON.stringify(finalBlocks) },
    overrideAccess: true,
    context: { _skipBlockSync: true },
  })

  payload.logger.info(
    `Seed complete: lesson=${lesson.id}, contentPages=${Object.keys(contentPageIds).length}, exercises=${Object.keys(exerciseIds).length}, blocks=${finalBlocks.length}`,
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('Failed to seed algebraic line intro lesson:', err)
  process.exit(1)
})
