/**
 * @fileType unit-test
 * @domain collections
 * @pattern schema-validation
 * @ai-summary Test that validates the Lessons collection has proper index/defaultSort and admin tab configuration
 */
import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { Lessons } from '@/server/payload/collections/Lessons'

type TabConfig = {
  label?: string
  name?: string
  fields: Field[]
}

type InspectableField = Field & {
  name?: string
  admin?: {
    components?: {
      Field?: string
    }
    description?: string
    hidden?: boolean
    position?: string
    readOnly?: boolean
  }
  defaultValue?: unknown
  hasMany?: boolean
  options?: Array<{ label: string; value: string }>
  relationTo?: string
  required?: boolean
  tabs?: TabConfig[]
  fields?: Field[]
  type?: string
}

const asInspectableField = (field: Field): InspectableField => field as InspectableField

const getTabsField = () => {
  const field = Lessons.fields.find((item) => asInspectableField(item).type === 'tabs')
  expect(field).toBeDefined()
  return asInspectableField(field as Field)
}

const getLessonTabs = () => {
  const tabs = getTabsField().tabs
  expect(tabs).toBeDefined()
  return tabs as TabConfig[]
}

const findField = (fields: Field[], name: string): InspectableField | undefined => {
  for (const field of fields) {
    const inspectable = asInspectableField(field)

    if (inspectable.name === name) return inspectable

    if (inspectable.fields) {
      const match = findField(inspectable.fields, name)
      if (match) return match
    }

    if (inspectable.tabs) {
      for (const tab of inspectable.tabs) {
        const match = findField(tab.fields, name)
        if (match) return match
      }
    }
  }

  return undefined
}

const fieldNames = (fields: Field[]) => fields.map((field) => asInspectableField(field).name)

const visibleFieldNames = (fields: Field[]) =>
  fields
    .filter((field) => asInspectableField(field).admin?.hidden !== true)
    .map((field) => asInspectableField(field).name)

const collectSidebarFields = (fields: Field[]): string[] =>
  fields.flatMap((field) => {
    const inspectable = asInspectableField(field)
    const current =
      inspectable.admin?.position === 'sidebar' && inspectable.name ? [inspectable.name] : []
    const nestedFields = inspectable.fields ? collectSidebarFields(inspectable.fields) : []
    const tabFields = inspectable.tabs
      ? inspectable.tabs.flatMap((tab) => collectSidebarFields(tab.fields))
      : []

    return [...current, ...nestedFields, ...tabFields]
  })

describe('Lessons Collection Config', () => {
  describe('order field configuration', () => {
    it('should have index: true on the order field for efficient sorting', () => {
      const orderField = findField(Lessons.fields, 'order')

      expect(orderField).toBeDefined()
      expect(orderField).toHaveProperty('type', 'number')
      expect(orderField).toHaveProperty('index', true)
    })

    it('should have defaultSort set to order in collection config', () => {
      expect(Lessons).toHaveProperty('defaultSort', 'order')
    })
  })

  describe('admin edit tabs', () => {
    it('should show Content, Exercises, System, and SEO tabs with Content first', () => {
      const tabs = getLessonTabs()

      expect(tabs.map((tab) => tab.label)).toEqual(['Content', 'Exercises', 'System', 'SEO'])
      expect(tabs[3].name).toBe('meta')
    })

    it('should keep only formulaSheet and contentNavigation in the sidebar', () => {
      expect(collectSidebarFields(Lessons.fields)).toEqual(['formulaSheet', 'contentNavigation'])
    })

    it('should place visible content fields in the requested order', () => {
      const [contentTab] = getLessonTabs()

      expect(visibleFieldNames(contentTab.fields)).toEqual([
        'topic',
        'chapter',
        'title',
        'type',
        'lessonObjective',
        'intro',
        'description',
        'formulas',
        'examples',
        'commonMistakes',
        'additionalNotes',
        'order',
        'prerequisites',
        'nextLessons',
        'prompt',
        'contentFiles',
        'conversionPanel',
        'lessonContextText',
      ])
      expect(findField(contentTab.fields, 'adminTitle')?.admin?.hidden).toBe(true)
      expect(findField(contentTab.fields, 'course')).toBeUndefined()
      expect(findField(contentTab.fields, 'prompt')?.admin?.position).toBeUndefined()
    })

    it('should configure the new content fields and descriptions', () => {
      const [contentTab] = getLessonTabs()
      const expectedTextareas = [
        ['lessonObjective', 'What the student should know or understand by the end of the lesson.'],
        ['formulas', 'Formulas relevant to this lesson.'],
        ['examples', 'Illustrative examples for the material.'],
        ['commonMistakes', 'Common student misconceptions to watch for.'],
        ['additionalNotes', 'Additional notes for the teacher / system.'],
      ] as const

      expect(findField(contentTab.fields, 'topic')).toMatchObject({
        type: 'text',
        admin: {
          description: 'Subject area (e.g. Mathematics). Free-text — no taxonomy yet.',
        },
      })

      for (const [name, description] of expectedTextareas) {
        expect(findField(contentTab.fields, name)).toMatchObject({
          type: 'textarea',
          admin: { description },
        })
      }

      expect(findField(contentTab.fields, 'nextLessons')).toMatchObject({
        type: 'relationship',
        relationTo: 'lessons',
        hasMany: true,
        admin: { description: 'Recommended follow-up lessons.' },
      })
    })

    it('should place exercise fields in the Exercises tab without changing lazy field wiring', () => {
      const [, exercisesTab] = getLessonTabs()

      expect(fieldNames(exercisesTab.fields)).toEqual(['blocks', 'contextExerciseViewer'])
      expect(findField(exercisesTab.fields, 'blocks')?.admin?.components?.Field).toBe(
        '@/ui/admin/LessonBlocksField#LessonBlocksField',
      )
    })

    it('should place read-only identity and system fields in the requested order', () => {
      const [, , systemTab] = getLessonTabs()

      expect(fieldNames(systemTab.fields)).toEqual([
        'lessonIdDisplay',
        'course',
        'status',
        'isActive',
        'tenant',
        'locale',
        'translatedFrom',
        'accessType',
        'visibleRenderers',
        'slug',
        'contentStatus',
        'contentStatusVisible',
        'contentStatusExpiresAt',
        'contentStatusLabel',
        'createdBy',
      ])
      expect(findField(systemTab.fields, 'lessonIdDisplay')).toMatchObject({
        type: 'ui',
        admin: {
          components: {
            Field: '@/ui/admin/LessonIdDisplay#LessonIdDisplay',
          },
        },
      })
      expect(findField(systemTab.fields, 'course')).toMatchObject({
        type: 'relationship',
        relationTo: 'courses',
        admin: {
          readOnly: true,
          description: 'Auto-populated from chapter. Used for filtering lessons by course.',
        },
      })
      expect(findField(systemTab.fields, 'course')?.admin?.hidden).not.toBe(true)
      expect(
        systemTab.fields.every((field) => asInspectableField(field).admin?.position !== 'sidebar'),
      ).toBe(true)
    })

    it('should compose the SEO tab inline with plugin fields and lesson-specific metadata', () => {
      const [, , , seoTab] = getLessonTabs()

      expect(fieldNames(seoTab.fields)).toEqual([
        'overview',
        'title',
        'image',
        'description',
        'preview',
        'keywords',
        'robots',
        'canonicalUrl',
      ])
      expect(findField(seoTab.fields, 'keywords')).toMatchObject({
        type: 'text',
        admin: { description: 'Comma-separated keywords / tags.' },
      })
      expect(findField(seoTab.fields, 'robots')).toMatchObject({
        type: 'select',
        defaultValue: 'index-follow',
        options: [
          { label: 'Index, Follow', value: 'index-follow' },
          { label: 'NoIndex, Follow', value: 'noindex-follow' },
          { label: 'NoIndex, NoFollow', value: 'noindex-nofollow' },
        ],
        admin: { description: 'Search engine visibility.' },
      })
      expect(findField(seoTab.fields, 'canonicalUrl')).toMatchObject({
        type: 'text',
        admin: {
          description:
            "Leave empty to use the page's default URL. Used to avoid duplicate content.",
        },
      })
    })

    it('should keep global lesson actions available outside individual tabs', () => {
      expect(Lessons.admin?.components?.edit?.beforeDocumentControls).toEqual([
        '@/ui/admin/TranslationButton#TranslateLessonAction',
        '@/ui/admin/CascadeDeleteButton#LessonCascadeDelete',
        '@/ui/admin/LessonExportButton/LessonExportButton#LessonExportAction',
        '@/ui/admin/LessonDuplicateButton/LessonDuplicateButton#LessonDuplicateAction',
      ])
    })
  })
})
