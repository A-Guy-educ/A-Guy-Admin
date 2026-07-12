import type { Access, CollectionConfig } from 'payload'

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
      if (req.context?._skipBlockSync) return doc

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
      if (req.context?._skipBlockSync) return doc

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
    useAsTitle: 'title',
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
  ],
}

export { DEFAULT_CONTENT } from './defaults'
