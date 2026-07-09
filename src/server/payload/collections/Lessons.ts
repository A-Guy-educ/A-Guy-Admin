import type { CollectionAfterReadHook, CollectionBeforeChangeHook, CollectionConfig } from 'payload'

import { DEFAULT_LESSON_ACCESS_TYPE } from '@/server/constants/access-types'
import { tenantField } from '@/server/payload/fields/tenant'
import { contentLocaleField } from '@/server/payload/fields/contentLocale'
import { adminOnly } from '../access/adminOnly'
import { publishedAndActive } from '../access/publishedAndActive'
import { contentStatusFields } from '../fields/contentStatus'
import { createdByField } from '../fields/createdBy'
import { formatSlug, formatSlugAsync } from '../fields/formatSlug'
import { translatedFromField } from '../fields/translatedFrom'
import { isContentPromotionImportRequest } from '@/server/services/content-promotion/import-context'

// Type for visibleRenderers field data
type VisibleRenderersData = {
  visibleRenderers?: string[] | null
}

type LessonAdminTitleData = {
  adminTitle?: string | null
  title?: string | null
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

const VALID_RENDERERS = ['media', 'pdf', 'interactive'] as const

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

const computeLessonAdminTitle: CollectionBeforeChangeHook = async ({ data, originalDoc, req }) => {
  // Bundle carries `adminTitle` verbatim from the source, so the two
  // findByID calls below (chapter + course) are pure overhead during
  // content-promotion imports.
  if (isContentPromotionImportRequest(req)) return data

  const lessonData = data as LessonAdminTitleData
  const originalLesson = originalDoc as LessonAdminTitleData | undefined
  const title = lessonData?.title ?? originalLesson?.title

  if (!title) return data

  const chapterValue = lessonData?.chapter ?? originalLesson?.chapter
  const chapterId = getRelationshipId(chapterValue)
  let chapterTitle =
    chapterValue && typeof chapterValue === 'object' && 'title' in chapterValue
      ? chapterValue.title
      : null
  let chapterLabel =
    chapterValue && typeof chapterValue === 'object' && 'chapterLabel' in chapterValue
      ? chapterValue.chapterLabel
      : null
  let courseTitle =
    chapterValue &&
    typeof chapterValue === 'object' &&
    'course' in chapterValue &&
    chapterValue.course &&
    typeof chapterValue.course === 'object' &&
    'title' in chapterValue.course
      ? chapterValue.course.title
      : null
  let courseLabel =
    chapterValue &&
    typeof chapterValue === 'object' &&
    'course' in chapterValue &&
    chapterValue.course &&
    typeof chapterValue.course === 'object' &&
    'courseLabel' in chapterValue.course
      ? chapterValue.course.courseLabel
      : null

  if (chapterId) {
    try {
      const chapter = await req.payload.findByID({
        collection: 'chapters',
        id: chapterId,
        depth: 1,
        overrideAccess: true,
        req,
      })

      chapterTitle = chapter?.title ?? chapterTitle
      chapterLabel = chapter?.chapterLabel ?? chapterLabel

      if (chapter?.course && typeof chapter.course === 'object') {
        courseTitle = chapter.course.title ?? courseTitle
        courseLabel = chapter.course.courseLabel ?? courseLabel
      }
    } catch {
      // Keep the title usable even if parent lookup fails.
    }
  }

  lessonData.adminTitle = [
    formatLabelPart(courseLabel, courseTitle),
    formatLabelPart(chapterLabel, chapterTitle),
    title,
  ]
    .filter(Boolean)
    .join(' / ')

  return data
}

const populateLessonAdminTitle: CollectionAfterReadHook = async ({ doc, req }) => {
  const lessonData = doc as LessonAdminTitleData
  const title = lessonData?.title

  if (!title) return doc

  const chapterValue = lessonData?.chapter
  const chapterId = getRelationshipId(chapterValue)
  let chapterTitle =
    chapterValue && typeof chapterValue === 'object' && 'title' in chapterValue
      ? chapterValue.title
      : null
  let chapterLabel =
    chapterValue && typeof chapterValue === 'object' && 'chapterLabel' in chapterValue
      ? chapterValue.chapterLabel
      : null
  let courseTitle =
    chapterValue &&
    typeof chapterValue === 'object' &&
    'course' in chapterValue &&
    chapterValue.course &&
    typeof chapterValue.course === 'object' &&
    'title' in chapterValue.course
      ? chapterValue.course.title
      : null
  let courseLabel =
    chapterValue &&
    typeof chapterValue === 'object' &&
    'course' in chapterValue &&
    chapterValue.course &&
    typeof chapterValue.course === 'object' &&
    'courseLabel' in chapterValue.course
      ? chapterValue.course.courseLabel
      : null

  if (chapterId) {
    try {
      const chapter = await req.payload.findByID({
        collection: 'chapters',
        id: chapterId,
        depth: 1,
        overrideAccess: true,
        req,
      })

      chapterTitle = chapter?.title ?? chapterTitle
      chapterLabel = chapter?.chapterLabel ?? chapterLabel

      if (chapter?.course && typeof chapter.course === 'object') {
        courseTitle = chapter.course.title ?? courseTitle
        courseLabel = chapter.course.courseLabel ?? courseLabel
      }
    } catch {
      // Keep title usable even if parent lookup fails.
    }
  }

  lessonData.adminTitle =
    [formatLabelPart(courseLabel, courseTitle), formatLabelPart(chapterLabel, chapterTitle), title]
      .filter(Boolean)
      .join(' / ') || title

  return doc
}

/**
 * Validates `visibleRenderers` when present. Treats missing/undefined as
 * "legacy lesson — all renderers enabled" so updates to lessons created
 * before this field existed don't fail. Explicit empty array still throws.
 */
const validateVisibleRenderers: CollectionBeforeChangeHook = async ({ data, operation }) => {
  if (operation !== 'create' && operation !== 'update') return data
  const renderers = (data as VisibleRenderersData | null)?.visibleRenderers
  // Backward compat: missing/undefined means legacy lesson — treat as all enabled.
  if (renderers === undefined || renderers === null) return data
  if (!Array.isArray(renderers) || renderers.length === 0) {
    throw new Error('At least one renderer must be visible to students.')
  }
  if (!renderers.every((r) => (VALID_RENDERERS as readonly string[]).includes(r))) {
    throw new Error('visibleRenderers contains an invalid value.')
  }
  return data
}

export const Lessons: CollectionConfig = {
  slug: 'lessons',
  defaultSort: 'order',
  access: {
    create: adminOnly,
    delete: adminOnly,
    read: publishedAndActive,
    update: adminOnly,
  },
  hooks: {
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
        if (!data) return data

        // Content-promotion imports carry the source's slug verbatim — the
        // find-loop below is a full Mongo query per lesson (up to 100 on
        // collision), which alone eats ~30s on a 53-lesson course over
        // Atlas via Vercel. Mongo's unique index on `slug` still catches
        // any actual collision at insert time; we just skip the pre-check.
        if (isContentPromotionImportRequest(req)) return data

        const title = data.title
        const titleChanged = operation === 'update' && title && title !== originalDoc?.title

        // When title changes → always regenerate slug from the new title
        // When no slug → generate from title
        // Otherwise → keep slug as-is (including " - Copy" from duplication)
        if (titleChanged || (!data.slug && title)) {
          data.slug = await formatSlugAsync(title)
        } else if (data.slug) {
          data.slug = data.slug.trim()
        }

        // Defense in depth: only sanitize if the slug contains characters that
        // aren't URL-safe (whitespace or punctuation other than `-`). Valid
        // existing slugs pass through untouched — only mangled inputs like
        // "Power - Copy" (from Payload's built-in duplicate) get reformatted.
        if (typeof data.slug === 'string' && /[^a-z0-9\-]/i.test(data.slug)) {
          data.slug = formatSlug(data.slug)
        }

        // On create, always ensure uniqueness (handles duplication & conflicts)
        // On update, ensure uniqueness only if slug changed
        const slugChanged = operation === 'update' && data.slug !== originalDoc?.slug
        if (data.slug && (operation === 'create' || slugChanged)) {
          const baseSlug = data.slug
          let slug = baseSlug
          let counter = 1
          const MAX_ATTEMPTS = 100

          for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
            const existing = await req.payload.find({
              collection: 'lessons',
              where: { slug: { equals: slug } },
              limit: 1,
              depth: 0,
              req,
            })

            if (existing.docs.length === 0) {
              data.slug = slug
              return data
            }

            slug = `${baseSlug}-${counter}`
            counter++
          }

          // Fallback: append timestamp if all numeric suffixes taken
          data.slug = `${baseSlug}-${Date.now().toString(36)}`
        }

        return data
      },
      // Auto-populate course from chapter -> course
      async ({ data, req }) => {
        // Bundle already carries the denormalized `course` field on every
        // lesson — see rationale on the exercise-hook skip.
        if (isContentPromotionImportRequest(req)) return data
        if (data?.chapter) {
          try {
            const chapterId = typeof data.chapter === 'string' ? data.chapter : data.chapter?.id
            if (chapterId) {
              const chapter = await req.payload.findByID({
                collection: 'chapters',
                id: chapterId,
                depth: 0,
                select: { course: true },
                req,
              })
              if (chapter?.course) {
                data.course =
                  typeof chapter.course === 'string' ? chapter.course : chapter.course?.id
              }
            }
          } catch {
            // Silently skip — course is a convenience field
          }
        }
        return data
      },
      computeLessonAdminTitle,
      validateVisibleRenderers,
    ],
    afterRead: [
      populateLessonAdminTitle,
      // In-memory population: when a lesson is read and its denormalized course
      // field is empty, resolve it from chapter -> course for the current request
      // so the UI displays correctly. The DB write that previously lived here
      // turned every list-view render into N+1 UPDATEs against a maxPoolSize=3
      // connection pool; the `beforeChange` hook above already persists `course`
      // on every save, so legacy docs get backfilled the next time they're edited.
      // Skipped during build/seed (no req.user) to avoid slow static generation.
      async ({ doc, req }) => {
        if (!doc?.chapter) return doc
        if (doc.course) return doc
        if (!req.user) return doc

        try {
          const chapterId = typeof doc.chapter === 'string' ? doc.chapter : doc.chapter?.id
          if (!chapterId) return doc

          const chapter = await req.payload.findByID({
            collection: 'chapters',
            id: chapterId,
            depth: 0,
            select: { course: true },
            req,
          })
          const courseId =
            typeof chapter?.course === 'string' ? chapter.course : chapter?.course?.id

          if (courseId) {
            doc.course = courseId
          }
        } catch {
          // Silently skip — in-memory backfill is best-effort
        }

        return doc
      },
    ],
  },
  // Hide Payload's built-in Duplicate action so admins can only use our
  // custom modal button. The built-in does a dumb field-copy that bypasses
  // the variation pipeline (so users were getting instant 44-exercise clones
  // and thinking the AI flow was broken).
  disableDuplicate: true,
  admin: {
    useAsTitle: 'adminTitle',
    // `adminTitle` already concatenates "<course> / <chapter> / <lesson>",
    // so searching it covers chapter + course terms without forcing depth-2
    // relationship joins on every list-view search.
    listSearchableFields: ['adminTitle', 'title'],
    components: {
      edit: {
        beforeDocumentControls: [
          '@/ui/admin/TranslationButton#TranslateLessonAction',
          '@/ui/admin/CascadeDeleteButton#LessonCascadeDelete',
          '@/ui/admin/LessonExportButton/LessonExportButton#LessonExportAction',
          '@/ui/admin/LessonDuplicateButton/LessonDuplicateButton#LessonDuplicateAction',
        ],
      },
    },
    defaultColumns: [
      'chapter',
      'title',
      'locale',
      'type',
      'slug',
      'order',
      'status',
      'isActive',
      'contentStatus',
      'updatedAt',
    ],
  },
  fields: [
    // Tenant
    tenantField,
    // Content locale
    contentLocaleField,
    // Translation link
    translatedFromField('lessons'),
    {
      name: 'chapter',
      type: 'relationship',
      relationTo: 'chapters',
      required: true,
      index: true,
      admin: {
        description: 'The chapter this lesson belongs to',
      },
    },
    {
      name: 'course',
      type: 'relationship',
      relationTo: 'courses',
      index: true,
      admin: {
        hidden: true,
        description: 'Auto-populated from chapter. Used for filtering lessons by course.',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'learning',
      index: true,
      options: [
        {
          label: 'Learning',
          value: 'learning',
        },
        {
          label: 'Practice',
          value: 'practice',
        },
        {
          label: 'Exam',
          value: 'exam',
        },
      ],
      admin: {
        description: 'The type of lesson: Learning content, Practice exercises, or Exam',
        position: 'sidebar',
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Lesson title',
      },
    },
    {
      name: 'adminTitle',
      type: 'text',
      index: true,
      admin: {
        hidden: true,
        description: 'Auto-computed display title for admin relationship dropdowns',
      },
    },
    {
      name: 'intro',
      type: 'textarea',
      admin: {
        description: 'Short intro shown on lesson cards before students start',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Detailed description of the lesson',
        components: {
          Field: '@/ui/admin/QuillField#QuillField',
        },
      },
    },
    {
      name: 'prerequisites',
      type: 'relationship',
      relationTo: 'lessons',
      hasMany: true,
      admin: {
        description: 'Lessons students should complete before this lesson',
      },
    },
    {
      name: 'order',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
      index: true,
      admin: {
        description: 'Sort order within the course',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'draft',
      options: [
        {
          label: 'Draft',
          value: 'draft',
        },
        {
          label: 'Published',
          value: 'published',
        },
        {
          label: 'Archived',
          value: 'archived',
        },
      ],
      admin: {
        description: 'Publication status of the lesson',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      admin: {
        description: 'Whether this lesson is currently active',
      },
    },
    {
      name: 'accessType',
      type: 'select',
      required: true,
      defaultValue: DEFAULT_LESSON_ACCESS_TYPE,
      options: [
        { label: 'Inherit from Course', value: 'inherit' },
        { label: 'Free Access', value: 'free' },
        { label: 'Require Registration', value: 'mandatory' },
        {
          label: 'Gated (5-Minute Delay)',
          value: 'gated',
        },
        { label: 'Paid (Requires Entitlement)', value: 'paid' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'Access control for this lesson. "Inherit" uses the parent course setting. "Gated" is a client-side nudge, not hard enforcement.',
      },
    },
    {
      name: 'visibleRenderers',
      type: 'select',
      hasMany: true,
      defaultValue: ['media', 'pdf', 'interactive'],
      options: [
        { label: 'Media (attached files)', value: 'media' },
        { label: 'Scroll view', value: 'pdf' },
        { label: 'Interactive (exercise pager)', value: 'interactive' },
      ],
      admin: {
        position: 'sidebar',
        description:
          'Which renderers are visible to students. At least one must be selected. Note: Media tab only appears when the lesson has attached files regardless of this toggle.',
      },
    },
    // --- Lesson Blocks (ordered playlist) ---
    {
      name: 'blocks',
      type: 'textarea',
      admin: {
        description: 'Ordered playlist of exercises and content pages. Defines the lesson flow.',
        components: {
          Field: '@/ui/admin/LessonBlocksField#LessonBlocksField',
        },
      },
    },
    // Context Exercise Viewer (displays parsed exercises from lessonContextText)
    {
      name: 'contextExerciseViewer',
      type: 'ui',
      admin: {
        components: {
          Field: '@/ui/admin/context-exercise-viewer#ContextExerciseViewer',
        },
      },
    },
    // --- Lesson Content ---
    {
      name: 'contentFiles',
      type: 'upload',
      relationTo: 'media',
      hasMany: true,
      admin: {
        description: 'Upload lesson content files (PDFs, videos, images, etc.)',
      },
    },
    // Exercise Conversion Panel (shows for each PDF - admin only)
    {
      name: 'conversionPanel',
      type: 'ui',
      admin: {
        components: {
          Field: '@/ui/admin/exercise-conversion/LessonConversionPanel#LessonConversionPanel',
        },
      },
    },
    {
      name: 'lessonContextText',
      type: 'textarea',
      maxLength: 200_000, // Match LESSON_CONTEXT_MAX_CHARS in src/infra/llm/lesson-context.ts
      admin: {
        description:
          'AI context text for this lesson. Injected into chat prompts at runtime. NOT indexed or searchable.',
      },
      // NOT indexed, NOT required
    },
    {
      name: 'prompt',
      type: 'relationship',
      relationTo: 'prompts',
      index: true,
      admin: {
        position: 'sidebar',
        description: 'AI system prompt for this lesson (uses default if not set)',
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: false,
      index: true,
      unique: true,
      admin: {
        position: 'sidebar',
        description: 'URL-friendly identifier (auto-generated from title if empty)',
      },
    },

    // Content Status
    ...contentStatusFields,

    // Formula Sheet (optional)
    {
      name: 'formulaSheet',
      type: 'relationship',
      relationTo: 'formula-sheets',
      maxDepth: 0,
      index: true,
      admin: {
        position: 'sidebar',
        description: 'Lesson-specific formula sheet (overrides course default)',
      },
    },

    // Content hierarchy navigation (sidebar)
    {
      name: 'contentNavigation',
      type: 'ui',
      admin: {
        position: 'sidebar',
        components: {
          Field: '@/ui/admin/ContentNavigation#LessonNavigation',
        },
      },
    },

    // Created By
    createdByField,
  ],
}
