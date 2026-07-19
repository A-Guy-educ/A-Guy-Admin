import type { Access, CollectionConfig, Field } from 'payload'

import { AccountRole, isAdvancedContentEditor } from '@/infra/auth/roles'
import type { User } from '@/payload-types'
import { contentLocaleField } from '@/server/payload/fields/contentLocale'
import { tenantField } from '@/server/payload/fields/tenant'
import { anyone } from '../../access/anyone'
import { authenticated } from '../../access/authenticated'
import { createdByField } from '../../fields/createdBy'
import { translatedFromField } from '../../fields/translatedFrom'
import { DEFAULT_CONTENT } from './defaults'
import { generateSlug, validateSlugUniqueness } from './hooks'
import { enforceContentStructure } from './hooks/enforceContentStructure'
import { ContentSchema } from './schemas'
import { addBlockToLesson, removeBlockFromLesson } from '../../hooks/lessons/syncLessonBlocks'
import { isContentPromotionImportRequest } from '@/server/services/content-promotion/import-context'
import { aggregateChildSectionContent } from './hooks/aggregateChildSectionContent'

type FieldWithAdminPosition = Field & {
  admin?: {
    position?: string
    [key: string]: unknown
  }
}

const withoutSidebarPosition = (field: Field): Field => {
  const admin = (field as FieldWithAdminPosition).admin
  if (admin?.position !== 'sidebar') return field

  return {
    ...field,
    admin: Object.fromEntries(Object.entries(admin).filter(([key]) => key !== 'position')),
  } as Field
}

/**
 * Access control - Exercise-specific
 * Admin or AdvancedContentEditor can update/delete, OR owner can update their own exercises
 */
const isAdminOrOwner: Access = ({ req }) => {
  const user = req.user as User | null
  if (!user) return false

  // Admin or AdvancedContentEditor can update any exercise
  if (user.role === AccountRole.Admin || isAdvancedContentEditor(user.role as AccountRole))
    return true

  // Owner can update their own exercises
  return {
    owner: {
      equals: user.id,
    },
  }
}

/**
 * Exercises Collection — Block-based content (correct model)
 *
 * Rule:
 * - content.blocks is a single ordered stream.
 * - Any question is a block type inside the stream.
 *
 * Therefore:
 * - NO exercise-level questionType
 * - NO exercise-level answer
 * - Each question block owns:
 *   - prompt (required)
 *   - answer (required)        <-- ONLY grading data
 *   - hint/solution/fullSolution (optional)  <-- teacher/explanation data
 */
/**
 * Hooks — extracted to avoid TS1117 on CI (duplicate property detection
 * in large inline object literals).
 */
const exerciseHooks: CollectionConfig['hooks'] = {
  beforeChange: [
    enforceContentStructure,
    // Auto-populate course from lesson -> chapter -> course
    async ({ data, req }) => {
      // Content-promotion imports carry `chapter` and `course` on every
      // exercise in the bundle (exported at depth: 0 with the denormalized
      // fields intact), so re-deriving them here would cost two extra
      // Mongo round trips per exercise for no data gain — 452 unnecessary
      // trips on a 226-exercise course, ~4 minutes on Atlas via Vercel.
      // See src/server/services/content-promotion/import-content.ts.
      if (isContentPromotionImportRequest(req)) return data
      if (data?.lesson) {
        try {
          const lessonId = typeof data.lesson === 'string' ? data.lesson : data.lesson?.id
          if (lessonId) {
            const lesson = await req.payload.findByID({
              collection: 'lessons',
              id: lessonId,
              depth: 0,
              select: { chapter: true },
            })
            const chapterId =
              typeof lesson?.chapter === 'string' ? lesson.chapter : lesson?.chapter?.id
            if (chapterId) {
              data.chapter = chapterId
              const chapter = await req.payload.findByID({
                collection: 'chapters',
                id: chapterId,
                depth: 0,
                select: { course: true },
              })
              if (chapter?.course) {
                data.course =
                  typeof chapter.course === 'string' ? chapter.course : chapter.course?.id
              }
            }
          }
        } catch {
          // Silently skip — course is a convenience field
        }
      }
      return data
    },
  ],
  afterRead: [
    // In-memory population: when an exercise is read and its denormalized
    // course/chapter fields are empty, resolve them from the hierarchy for the
    // current request so the UI displays correctly. The DB write that previously
    // lived here turned every list-view render into N+1 UPDATEs against a
    // maxPoolSize=3 connection pool; the `beforeChange` hook above already
    // persists `course` on every save, so legacy docs get backfilled the next
    // time they're edited.
    // Skipped during build/seed (no req.user) to avoid slow static generation.
    async ({ doc, req }) => {
      if (!doc?.lesson) return doc
      if (doc.course && doc.chapter) return doc
      if (!req.user) return doc

      try {
        const lessonId = typeof doc.lesson === 'string' ? doc.lesson : doc.lesson?.id
        if (!lessonId) return doc

        const lesson = await req.payload.findByID({
          collection: 'lessons',
          id: lessonId,
          depth: 0,
          select: { chapter: true },
        })
        const chapterId = typeof lesson?.chapter === 'string' ? lesson.chapter : lesson?.chapter?.id
        if (!chapterId) return doc

        const chapter = await req.payload.findByID({
          collection: 'chapters',
          id: chapterId,
          depth: 0,
          select: { course: true },
        })
        const courseId = typeof chapter?.course === 'string' ? chapter.course : chapter?.course?.id

        if (chapterId && !doc.chapter) doc.chapter = chapterId
        if (courseId && !doc.course) doc.course = courseId
      } catch {
        // Silently skip — in-memory backfill is best-effort
      }

      return doc
    },
    // Read-time compat shim: if the exercise has no `content.blocks` of its
    // own but has child sections, concatenate each section's `content.blocks`
    // into `doc.content.blocks` in memory. The sibling A-Guy-Web repo still
    // reads the legacy `exercise.content.blocks` field in ~6 places and
    // doesn't know about sections yet. This keeps that path working
    // transparently. Skipped during build/seed (no req.user) and during
    // content-promotion imports (the bundle already carries the full
    // `content.blocks` payload and must not be reshuffled).
    aggregateChildSectionContent,
  ],
  afterChange: [
    async ({ doc, previousDoc, req }) => {
      if (req.context?._skipBlockSync) return doc
      // Content-promotion imports carry the parent `lesson.blocks` playlist
      // verbatim from the source, so re-syncing here is redundant and
      // actively harmful: exporter PR #242 pulls in exercises referenced by
      // a lesson's playlist even when their own `lesson` field points at a
      // lesson from a different course. Those cross-course exercises land
      // pointing at a lesson that isn't in the bundle; the sync helper's
      // `findByID` on that missing lesson throws "Not Found" (see
      // `addBlockToLesson`/`removeBlockFromLesson` in syncLessonBlocks.ts)
      // and kills the whole per-doc create. Same reasoning as the
      // beforeChange auto-populate skip above.
      if (isContentPromotionImportRequest(req)) return doc

      const newLessonId =
        typeof doc.lesson === 'string' ? doc.lesson : (doc.lesson as { id?: string })?.id
      const oldLessonId = previousDoc
        ? typeof previousDoc.lesson === 'string'
          ? previousDoc.lesson
          : (previousDoc.lesson as { id?: string })?.id
        : null

      // Lesson changed — remove from old, add to new
      if (oldLessonId && oldLessonId !== newLessonId) {
        await removeBlockFromLesson({
          payload: req.payload,
          req,
          lessonId: oldLessonId,
          refId: doc.id,
          blockType: 'exerciseRef',
        })
      }

      // Only auto-add when the lesson association changes (create or reassignment).
      // Without this guard, every exercise edit re-appends the block, undoing
      // any deletion an admin made from the lesson blocks UI.
      if (newLessonId && oldLessonId !== newLessonId) {
        await addBlockToLesson({
          payload: req.payload,
          req,
          lessonId: newLessonId,
          refId: doc.id,
          blockType: 'exerciseRef',
        })
      }

      return doc
    },
  ],
  afterDelete: [
    async ({ doc, req }) => {
      if (req.context?._skipBlockSync) return doc
      // Same rationale as the afterChange skip above — content-promotion
      // bundles carry lesson.blocks verbatim, and cross-course exercises
      // point at lessons that may not exist on the target.
      if (isContentPromotionImportRequest(req)) return doc

      const lessonId =
        typeof doc.lesson === 'string' ? doc.lesson : (doc.lesson as { id?: string })?.id
      if (lessonId) {
        await removeBlockFromLesson({
          payload: req.payload,
          req,
          lessonId,
          refId: doc.id,
          blockType: 'exerciseRef',
        })
      }

      return doc
    },
  ],
}

export const Exercises: CollectionConfig = {
  slug: 'exercises',
  access: {
    create: authenticated,
    delete: isAdminOrOwner,
    read: anyone,
    update: isAdminOrOwner,
  },
  hooks: exerciseHooks,

  admin: {
    useAsTitle: 'title',
    defaultColumns: ['order', 'title', 'lesson', 'updatedAt'],
    components: {
      edit: {
        beforeDocumentControls: ['@/ui/admin/TranslationButton#TranslateExerciseAction'],
      },
    },
  },

  fields: [
    {
      type: 'tabs',
      tabs: [
        {
          label: 'Content',
          fields: [
            {
              name: 'subject',
              type: 'text',
              admin: {
                description: 'Subject area (e.g. Mathematics). Free text — no taxonomy yet.',
              },
            },
            {
              name: 'topic',
              type: 'text',
              admin: {
                description: 'Topic within the subject (e.g. Quadratic equations).',
              },
            },
            {
              name: 'chapter',
              type: 'relationship',
              relationTo: 'chapters',
              index: true,
              admin: {
                readOnly: true,
                description: 'Auto-populated from lesson hierarchy',
              },
            },
            {
              name: 'title',
              type: 'text',
              required: false,
              admin: { description: 'Exercise title (for admin reference)' },
            },
            {
              name: 'order',
              type: 'number',
              required: false,
              defaultValue: 0,
              admin: {
                description:
                  'DEPRECATED — Order is now defined by lesson blocks array. Kept for backward compatibility.',
              },
            },
            {
              name: 'slug',
              type: 'text',
              required: false,
              index: true,
              admin: {
                description:
                  'URL-friendly identifier (auto-generated from title, unique within lesson)',
              },
              hooks: {
                beforeValidate: [generateSlug, validateSlugUniqueness],
              },
            },
            {
              name: 'content',
              type: 'json',
              required: true,
              defaultValue: DEFAULT_CONTENT,
              validate: (value: unknown) => {
                const result = ContentSchema.safeParse(value)
                if (result.success) return true
                // Log full error for server-side debugging
                console.error(
                  '[Exercise content validation]',
                  JSON.stringify(result.error.issues, null, 2),
                )
                const issues = result.error.issues
                  .map((i) => `[${i.path.join('.')}] ${i.message}`)
                  .join('; ')
                return `Invalid content: ${issues}`
              },
              admin: {
                description:
                  'Legacy inline blocks. For new content, prefer authoring child Sections.',
                components: {
                  Field: '@/ui/admin/ExerciseContentEditor#ExerciseContentEditor',
                },
              },
            },
          ],
        },
        {
          label: 'Sections',
          fields: [
            {
              name: 'blocks',
              type: 'textarea',
              admin: {
                description:
                  'Ordered playlist of sections. Populated automatically by the Sections collection hooks and editable from this side via the playlist UI.',
                components: {
                  Field: '@/ui/admin/ExerciseBlocksField#ExerciseBlocksField',
                },
              },
            },
          ],
        },
        {
          label: 'System',
          fields: [
            {
              name: 'exerciseIdDisplay',
              type: 'ui',
              admin: {
                components: {
                  Field: '@/ui/admin/ExerciseIdDisplay#ExerciseIdDisplay',
                },
              },
            },
            {
              name: 'lesson',
              type: 'relationship',
              relationTo: 'lessons',
              required: true,
              index: true,
              admin: { description: 'The lesson this exercise belongs to' },
            },
            {
              name: 'course',
              type: 'relationship',
              relationTo: 'courses',
              index: true,
              admin: {
                readOnly: true,
                description:
                  'Auto-populated from lesson hierarchy. Used for filtering exercises by course.',
              },
            },
            {
              name: 'showQuestionNumbering',
              type: 'checkbox',
              defaultValue: false,
              admin: {
                description:
                  'Show exercise question numbering (the circled number above questions). Enable when multiple exercises share a page.',
              },
            },
            withoutSidebarPosition(tenantField),
            withoutSidebarPosition(contentLocaleField),
            withoutSidebarPosition(translatedFromField('exercises')),
            withoutSidebarPosition(createdByField),
            // ADD: Conversion Metadata Section
            {
              type: 'collapsible',
              label: 'Conversion Metadata',
              admin: { initCollapsed: true },
              fields: [
                {
                  name: 'origin',
                  type: 'select',
                  options: [
                    { label: 'Manual', value: 'manual' },
                    { label: 'Conversion', value: 'conversion' },
                    { label: 'Import', value: 'import' },
                    { label: 'Context Extraction', value: 'context_extraction' },
                  ],
                  defaultValue: 'manual',
                  required: true,
                  index: true,
                  hooks: {
                    beforeValidate: [
                      async ({ value, operation }) => {
                        // Backfill: set default for existing exercises without origin
                        if (operation === 'update' && !value) {
                          return 'manual'
                        }
                        return value || 'manual'
                      },
                    ],
                  },
                },
                {
                  name: 'sourceDoc',
                  type: 'relationship',
                  relationTo: 'media',
                  index: true,
                  admin: { description: 'Original PDF media for conversion exercises' },
                },
                {
                  name: 'sourceLatex',
                  type: 'textarea',
                  admin: {
                    description:
                      'Raw LaTeX chunk this exercise was derived from (for LaTeX imports)',
                  },
                },
                {
                  name: 'conversionJobId',
                  type: 'text',
                  admin: { description: 'Payload job ID that created this exercise' },
                },
                {
                  name: 'sourcePageStart',
                  type: 'number',
                  admin: { description: 'Starting page in source PDF' },
                },
                {
                  name: 'sourcePageEnd',
                  type: 'number',
                  admin: { description: 'Ending page in source PDF' },
                },
                {
                  name: 'sourceOrderInSegment',
                  type: 'number',
                  admin: { description: 'Order within the segment (1-indexed)' },
                },
                {
                  name: 'contentHash',
                  type: 'text',
                  admin: { description: 'SHA256 hash for deduplication' },
                },
                // Stage 3: Idempotency fields (shadow fields - not yet enforcing uniqueness)
                {
                  name: 'idempotencyKey',
                  type: 'text',
                  index: true, // Non-unique for now, will be unique in Stage 4
                  admin: {
                    description:
                      'Source-based identity key (tenant:lesson:doc:pages:ordinal:version)',
                    hidden: true, // Hidden from admin UI - technical field
                  },
                },
                {
                  name: 'specVersion',
                  type: 'text',
                  admin: {
                    description: 'Extraction spec version for idempotency key stability',
                    hidden: true,
                  },
                },
                {
                  name: 'extractionMeta',
                  type: 'json',
                  admin: {
                    description: 'Additional extraction metadata (segmentIndex, itemOrdinal)',
                    hidden: true,
                  },
                },
                // V2-specific fields for image crop pipeline
                {
                  name: 'pipelineVersion',
                  type: 'number',
                  index: true,
                  admin: {
                    description: 'Pipeline version (1=text extraction, 2=image crops)',
                    hidden: true,
                  },
                },
                {
                  name: 'sourcePageIndex',
                  type: 'number',
                  admin: {
                    description: 'Zero-based page index in source PDF (V2 image crops)',
                    hidden: true,
                  },
                },
                {
                  name: 'sourceBboxNormalized',
                  type: 'json',
                  admin: {
                    description: 'Normalized bounding box {x,y,width,height} 0..1 (V2 image crops)',
                    hidden: true,
                  },
                },
              ],
            },
          ],
        },
      ],
    },

    // Content hierarchy navigation (sidebar)
    {
      name: 'contentNavigation',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: {
          Field: '@/ui/admin/ContentNavigation#ExerciseNavigation',
        },
      },
    },

    // In-place LaTeX block → structured content conversion (V1-258/260)
    {
      name: 'convertLatexBlock',
      type: 'ui',
      admin: {
        components: {
          Field: '@/ui/admin/exercise-conversion/ConvertLatexBlockButton#ConvertLatexBlockButton',
        },
      },
    },

    // Preview field (sidebar)
    {
      name: 'preview',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: {
          Field: '@/ui/admin/ExercisePreview#ExercisePreview',
        },
      },
    },
  ],
}

// Re-export types and utilities for backward compatibility
export { DEFAULT_CONTENT, ExerciseBlockDefaults, generateId } from './defaults'
export type { ContentBlock, ContentSchema, ExerciseContent, LatexBlock } from './schemas'
