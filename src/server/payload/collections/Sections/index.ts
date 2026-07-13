import type {
  CollectionAfterReadHook,
  CollectionBeforeChangeHook,
  Access,
  CollectionConfig,
} from 'payload'

import { AccountRole, isAdvancedContentEditor } from '@/infra/auth/roles'
import type { User } from '@/payload-types'
import { contentLocaleField } from '@/server/payload/fields/contentLocale'
import { tenantField } from '@/server/payload/fields/tenant'
import { isContentPromotionImportRequest } from '@/server/services/content-promotion/import-context'
import { anyone } from '../../access/anyone'
import { authenticated } from '../../access/authenticated'
import { createdByField } from '../../fields/createdBy'
import { translatedFromField } from '../../fields/translatedFrom'
import { ContentSchema } from '../Exercises/schemas'
import { DEFAULT_CONTENT } from './defaults'
import { generateSlug, validateSlugUniqueness } from './hooks'
import {
  addBlockToExercise,
  removeBlockFromExercise,
} from '../../hooks/exercises/syncExerciseBlocks'

type SectionAdminTitleData = {
  adminTitle?: string | null
  title?: string | null
  course?:
    | string
    | {
        id?: string | null
        title?: string | null
        courseLabel?: string | null
      }
    | null
  chapter?:
    | string
    | {
        id?: string | null
        title?: string | null
        chapterLabel?: string | null
        course?:
          | string
          | {
              id?: string | null
              title?: string | null
              courseLabel?: string | null
            }
          | null
      }
    | null
  lesson?:
    | string
    | {
        id?: string | null
        title?: string | null
        adminTitle?: string | null
        chapter?:
          | string
          | {
              id?: string | null
              title?: string | null
              chapterLabel?: string | null
              course?:
                | string
                | {
                    id?: string | null
                    title?: string | null
                    courseLabel?: string | null
                  }
                | null
            }
          | null
      }
    | null
  exercise?:
    | string
    | {
        id?: string | null
        title?: string | null
        lesson?:
          | string
          | {
              id?: string | null
              title?: string | null
              adminTitle?: string | null
              chapter?:
                | string
                | {
                    id?: string | null
                    title?: string | null
                    chapterLabel?: string | null
                  }
                | null
            }
          | null
      }
    | null
}

const getRelationshipId = (value: unknown): string | null => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value && typeof value.id === 'string') {
    return value.id
  }
  return null
}

const formatLabelPart = (...parts: Array<string | null | undefined>) =>
  [
    ...new Set(parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part))),
  ].join(' ')

/**
 * Read the title-like parts of a relationship value WITHOUT triggering a
 * Mongo round trip. Falls back to the stored ID when the value is unresolved.
 * The matching `findByID` lookup below is what actually resolves the labels.
 *
 * IMPORTANT: only `title` is read, never `adminTitle`. `Lessons` uses
 * `adminTitle` as its `useAsTitle`, so a populated `section.lesson` carries an
 * `adminTitle` that is already the breadcrumb "course / chapter / lesson".
 * Preferring it here duplicates course + chapter segments in the section
 * chain.
 */
const readInlineLabel = (value: unknown): { id: string | null; title: string | null } => {
  const id = getRelationshipId(value)
  if (!value || typeof value !== 'object') return { id, title: null }
  const obj = value as { title?: string | null }
  return { id, title: obj.title || null }
}

const joinChain = (parts: Array<string | null | undefined>): string =>
  parts
    .map((part) => part?.trim() ?? '')
    .filter(Boolean)
    .join(' / ')

/**
 * Build the section `adminTitle` (`course / chapter / lesson / exercise / section`)
 * by walking the stored relationships on the section/exercise/lesson/chapter
 * documents. When the in-memory payload only carries IDs, we fall back to a
 * single Mongo findByID call (matching the pattern in
 * `Lessons.ts:computeLessonAdminTitle`).
 *
 * Skipped during content-promotion imports — the bundle carries `adminTitle`
 * verbatim, so re-deriving would be pure overhead.
 */
const computeSectionAdminTitle: CollectionBeforeChangeHook = async ({ data, req }) => {
  if (isContentPromotionImportRequest(req)) return data
  if (!data) return data

  const sectionData = data as SectionAdminTitleData
  const title = sectionData.title
  if (!title) {
    sectionData.adminTitle = undefined
    return data
  }

  const inlineExercise = readInlineLabel(sectionData.exercise)
  const inlineLesson = readInlineLabel(sectionData.lesson)
  const inlineChapter = readInlineLabel(sectionData.chapter)
  const inlineCourse = readInlineLabel(sectionData.course)

  let exerciseTitle = inlineExercise.title
  let lessonTitle = inlineLesson.title
  let chapterTitle = inlineChapter.title
  let chapterLabel = inlineChapter.id
    ? (inlineChapter.title &&
        ((sectionData.chapter as { chapterLabel?: string | null } | undefined)?.chapterLabel ??
          null)) ||
      null
    : null
  let courseTitle = inlineCourse.title
  let courseLabel: string | null = null

  // Resolve labels that aren't already inlined. Each findByID is a single
  // Mongo round trip; we skip the chain walk that Exercises/Lessons use
  // because Sections already denormalize `lesson/chapter/course` on save.
  if (inlineExercise.id && !exerciseTitle) {
    try {
      const exercise = await req.payload.findByID({
        collection: 'exercises',
        id: inlineExercise.id,
        depth: 0,
        overrideAccess: true,
        req,
      })
      exerciseTitle = (exercise as { title?: string | null } | null)?.title ?? null
    } catch {
      // Keep id-only fallback
    }
  }

  if (inlineLesson.id && !lessonTitle) {
    try {
      const lesson = await req.payload.findByID({
        collection: 'lessons',
        id: inlineLesson.id,
        depth: 0,
        overrideAccess: true,
        req,
      })
      lessonTitle = (lesson as { title?: string | null } | null)?.title ?? null
    } catch {
      // Keep id-only fallback
    }
  }

  if (inlineChapter.id) {
    try {
      const chapter = await req.payload.findByID({
        collection: 'chapters',
        id: inlineChapter.id,
        depth: 0,
        overrideAccess: true,
        req,
      })
      chapterTitle = (chapter as { title?: string | null } | null)?.title ?? chapterTitle
      chapterLabel = (chapter as { chapterLabel?: string | null } | null)?.chapterLabel ?? null
    } catch {
      // Keep id-only fallback
    }
  }

  if (inlineCourse.id) {
    try {
      const course = await req.payload.findByID({
        collection: 'courses',
        id: inlineCourse.id,
        depth: 0,
        overrideAccess: true,
        req,
      })
      courseTitle = (course as { title?: string | null } | null)?.title ?? courseTitle
      courseLabel = (course as { courseLabel?: string | null } | null)?.courseLabel ?? null
    } catch {
      // Keep id-only fallback
    }
  }

  const fullChain = joinChain([
    formatLabelPart(courseLabel, courseTitle),
    formatLabelPart(chapterLabel, chapterTitle),
    lessonTitle,
    exerciseTitle,
    title,
  ])

  sectionData.adminTitle = fullChain || title
  return data
}

/** Extract a label field (chapterLabel / courseLabel) from a populated relation. */
const readInlineLabelField = (
  value: unknown,
  field: 'chapterLabel' | 'courseLabel',
): string | null => {
  if (!value || typeof value !== 'object') return null
  return ((value as Record<string, unknown>)[field] as string | null | undefined) ?? null
}

const populateSectionAdminTitle: CollectionAfterReadHook = async ({ doc, req }) => {
  if (!doc) return doc
  // Bundles carry the denormalized `adminTitle` verbatim — recomputing on
  // every import-time read would burn Mongo round trips and could overwrite
  // the bundled value with a stale local chain. Matches the beforeChange skip.
  if (isContentPromotionImportRequest(req)) return doc
  const sectionData = doc as SectionAdminTitleData
  const title = sectionData.title
  if (!title) return doc

  // Read inline only — no findByID fallback. This hook fires on every section
  // read, and even one extra round-trip per relation compounds fast enough to
  // push the CI Integration Tests job past its 15-min timeout. Callers that
  // want the full breadcrumb should read at `depth: 1`; at `depth: 0` we
  // degrade to whatever segments are already present in memory.
  const exerciseTitle = readInlineLabel(sectionData.exercise).title
  const lessonTitle = readInlineLabel(sectionData.lesson).title
  const chapterTitle = readInlineLabel(sectionData.chapter).title
  const chapterLabel = readInlineLabelField(sectionData.chapter, 'chapterLabel')
  const courseTitle = readInlineLabel(sectionData.course).title
  const courseLabel = readInlineLabelField(sectionData.course, 'courseLabel')

  const fullChain = joinChain([
    formatLabelPart(courseLabel, courseTitle),
    formatLabelPart(chapterLabel, chapterTitle),
    lessonTitle,
    exerciseTitle,
    title,
  ])

  sectionData.adminTitle = fullChain || title
  return doc
}

/**
 * Access control — Section-specific
 * Admin or AdvancedContentEditor can update/delete, OR owner can update their own sections.
 *
 * Sections inherit the visibility + ownership model from exercises (their
 * parent). Once the exercise-side blocks field lands, the playlist will be the
 * authoritative ordering; until then `order` is editable and acts as a
 * fallback so admin UIs stay sane.
 */
const isAdminOrOwner: Access = ({ req }) => {
  const user = req.user as User | null
  if (!user) return false

  if (user.role === AccountRole.Admin || isAdvancedContentEditor(user.role as AccountRole)) {
    return true
  }

  return {
    owner: {
      equals: user.id,
    },
  }
}

const sectionHooks: CollectionConfig['hooks'] = {
  beforeChange: [
    computeSectionAdminTitle,
    // Auto-populate lesson/chapter/course from the parent exercise chain.
    // Skipped during content-promotion imports (bundle carries the denormalized
    // fields verbatim, and the Mongo round trips here would balloon a 226-exercise
    // course import by ~4 minutes). See the matching skip on Exercises + Lessons.
    async ({ data, req }) => {
      if (isContentPromotionImportRequest(req)) return data
      if (data?.exercise) {
        try {
          const exerciseId = typeof data.exercise === 'string' ? data.exercise : data.exercise?.id
          if (exerciseId) {
            const exercise = await req.payload.findByID({
              collection: 'exercises',
              id: exerciseId,
              depth: 0,
              select: { lesson: true, chapter: true, course: true },
            })
            const lessonId =
              typeof exercise?.lesson === 'string' ? exercise.lesson : exercise?.lesson?.id
            const chapterId =
              typeof exercise?.chapter === 'string' ? exercise.chapter : exercise?.chapter?.id
            const courseId =
              typeof exercise?.course === 'string' ? exercise.course : exercise?.course?.id

            if (lessonId) data.lesson = lessonId
            if (chapterId) data.chapter = chapterId
            if (courseId) data.course = courseId

            // Fallback: when the parent exercise hasn't been backfilled yet,
            // walk lesson → chapter → course ourselves so the section's
            // denormalized fields stay useful for filtering.
            if (!chapterId && lessonId) {
              const lesson = await req.payload.findByID({
                collection: 'lessons',
                id: lessonId,
                depth: 0,
                select: { chapter: true },
              })
              const resolvedChapterId =
                typeof lesson?.chapter === 'string' ? lesson.chapter : lesson?.chapter?.id
              if (resolvedChapterId) {
                data.chapter = resolvedChapterId
                const chapter = await req.payload.findByID({
                  collection: 'chapters',
                  id: resolvedChapterId,
                  depth: 0,
                  select: { course: true },
                })
                if (chapter?.course) {
                  data.course =
                    typeof chapter.course === 'string' ? chapter.course : chapter.course?.id
                }
              }
            }
          }
        } catch {
          // Silently skip — denormalized fields are convenience only
        }
      }
      return data
    },
  ],
  afterRead: [
    populateSectionAdminTitle,
    // In-memory backfill: when a section is read and its denormalized
    // lesson/chapter/course fields are empty, resolve them from the parent
    // exercise (or the lesson → chapter → course chain). The `beforeChange`
    // hook above already persists these on every save, so this only fires
    // for legacy docs read before they've been edited. Skipped during
    // build/seed (no req.user) to avoid slowing static generation.
    async ({ doc, req }) => {
      if (!doc?.exercise) return doc
      if (doc.lesson && doc.chapter && doc.course) return doc
      if (!req.user) return doc

      try {
        const exerciseId = typeof doc.exercise === 'string' ? doc.exercise : doc.exercise?.id
        if (!exerciseId) return doc

        const exercise = await req.payload.findByID({
          collection: 'exercises',
          id: exerciseId,
          depth: 0,
          select: { lesson: true, chapter: true, course: true },
        })
        const lessonId =
          typeof exercise?.lesson === 'string' ? exercise.lesson : exercise?.lesson?.id
        const chapterId =
          typeof exercise?.chapter === 'string' ? exercise.chapter : exercise?.chapter?.id
        const courseId =
          typeof exercise?.course === 'string' ? exercise.course : exercise?.course?.id

        if (lessonId && !doc.lesson) doc.lesson = lessonId
        if (chapterId && !doc.chapter) doc.chapter = chapterId
        if (courseId && !doc.course) doc.course = courseId

        // Last-resort fallback when the parent exercise has no denormalized
        // fields either (very old data).
        if (!chapterId && lessonId) {
          const lesson = await req.payload.findByID({
            collection: 'lessons',
            id: lessonId,
            depth: 0,
            select: { chapter: true },
          })
          const resolvedChapterId =
            typeof lesson?.chapter === 'string' ? lesson.chapter : lesson?.chapter?.id
          if (resolvedChapterId) {
            if (!doc.chapter) doc.chapter = resolvedChapterId
            const chapter = await req.payload.findByID({
              collection: 'chapters',
              id: resolvedChapterId,
              depth: 0,
              select: { course: true },
            })
            const resolvedCourseId =
              typeof chapter?.course === 'string' ? chapter.course : chapter?.course?.id
            if (resolvedCourseId && !doc.course) doc.course = resolvedCourseId
          }
        }
      } catch {
        // Silently skip — in-memory backfill is best-effort
      }

      return doc
    },
  ],
  afterChange: [
    async ({ doc, previousDoc, req }) => {
      if (req.context?._skipExerciseBlockSync) return doc

      const newExerciseId =
        typeof doc.exercise === 'string' ? doc.exercise : (doc.exercise as { id?: string })?.id
      const oldExerciseId = previousDoc
        ? typeof previousDoc.exercise === 'string'
          ? previousDoc.exercise
          : (previousDoc.exercise as { id?: string })?.id
        : null

      // Exercise changed — remove from old, add to new
      if (oldExerciseId && oldExerciseId !== newExerciseId) {
        await removeBlockFromExercise({
          payload: req.payload,
          req,
          exerciseId: oldExerciseId,
          refId: doc.id,
          blockType: 'sectionRef',
        })
      }

      // Only auto-add when the exercise association changes (create or
      // reassignment). Without this guard, every section edit re-appends the
      // block, undoing any deletion an admin made from the exercise playlist.
      if (newExerciseId && oldExerciseId !== newExerciseId) {
        await addBlockToExercise({
          payload: req.payload,
          req,
          exerciseId: newExerciseId,
          refId: doc.id,
          blockType: 'sectionRef',
        })
      }

      return doc
    },
  ],
  afterDelete: [
    async ({ doc, req }) => {
      if (req.context?._skipExerciseBlockSync) return doc

      const exerciseId =
        typeof doc.exercise === 'string' ? doc.exercise : (doc.exercise as { id?: string })?.id
      if (exerciseId) {
        await removeBlockFromExercise({
          payload: req.payload,
          req,
          exerciseId,
          refId: doc.id,
          blockType: 'sectionRef',
        })
      }

      return doc
    },
  ],
}

export const Sections: CollectionConfig = {
  slug: 'sections',
  access: {
    create: authenticated,
    delete: isAdminOrOwner,
    read: anyone,
    update: isAdminOrOwner,
  },
  hooks: sectionHooks,
  admin: {
    useAsTitle: 'adminTitle',
    listSearchableFields: ['adminTitle', 'title'],
    defaultColumns: ['order', 'title', 'exercise', 'updatedAt'],
  },
  fields: [
    tenantField,
    contentLocaleField,
    translatedFromField('sections'),

    {
      type: 'collapsible',
      label: 'Section Meta (Basics)',
      admin: { initCollapsed: false },
      fields: [
        {
          name: 'title',
          type: 'text',
          required: false,
          admin: { description: 'Section title (for admin reference)' },
        },
        {
          name: 'adminTitle',
          type: 'text',
          index: true,
          admin: {
            hidden: true,
            description:
              'Auto-computed display title for admin relationship dropdowns (course / chapter / lesson / exercise / section)',
          },
        },
        {
          name: 'order',
          type: 'number',
          required: false,
          defaultValue: 0,
          admin: {
            description:
              'DEPRECATED — Order is now defined by exercise blocks array. Kept for backward compatibility.',
          },
        },
        {
          name: 'exercise',
          type: 'relationship',
          relationTo: 'exercises',
          required: true,
          index: true,
          admin: { description: 'The exercise this section belongs to' },
        },
        {
          name: 'lesson',
          type: 'relationship',
          relationTo: 'lessons',
          index: true,
          admin: {
            hidden: true,
            description:
              'Auto-populated from exercise hierarchy. Used for filtering sections by lesson.',
          },
        },
        {
          name: 'chapter',
          type: 'relationship',
          relationTo: 'chapters',
          index: true,
          admin: {
            hidden: true,
            description:
              'Auto-populated from exercise hierarchy. Used for filtering sections by chapter.',
          },
        },
        {
          name: 'course',
          type: 'relationship',
          relationTo: 'courses',
          index: true,
          admin: {
            hidden: true,
            description:
              'Auto-populated from exercise hierarchy. Used for filtering sections by course.',
          },
        },
        {
          name: 'slug',
          type: 'text',
          required: false,
          index: true,
          admin: {
            description:
              'URL-friendly identifier (auto-generated from title, unique within exercise)',
          },
          hooks: {
            beforeValidate: [generateSlug, validateSlugUniqueness],
          },
        },
      ],
    },

    {
      type: 'collapsible',
      label: 'Content',
      admin: { initCollapsed: false },
      fields: [
        {
          name: 'content',
          type: 'json',
          required: true,
          defaultValue: DEFAULT_CONTENT,
          validate: (value: unknown) => {
            const result = ContentSchema.safeParse(value)
            if (result.success) return true
            console.error(
              '[Section content validation]',
              JSON.stringify(result.error.issues, null, 2),
            )
            const issues = result.error.issues
              .map((i) => `[${i.path.join('.')}] ${i.message}`)
              .join('; ')
            return `Invalid content: ${issues}`
          },
          admin: {
            description:
              'Ordered blocks stream. Use question_* blocks to add questions, and rich_text blocks for instructions/notes between questions.',
          },
        },
      ],
    },

    createdByField,
    // Content hierarchy navigation (sidebar)
    {
      name: 'contentNavigation',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: {
          Field: '@/ui/admin/ContentNavigation#SectionNavigation',
        },
      },
    },
  ],
}

export { DEFAULT_CONTENT } from './defaults'
