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
  fields: Field[]
}

type InspectableField = Field & {
  name?: string
  admin?: {
    position?: string
  }
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
    it('should show Content, Exercises, and System tabs with Content first', () => {
      const tabs = getLessonTabs()

      expect(tabs.map((tab) => tab.label)).toEqual(['Content', 'Exercises', 'System'])
    })

    it('should keep only type, formulaSheet, and contentNavigation in the sidebar', () => {
      expect(collectSidebarFields(Lessons.fields)).toEqual([
        'type',
        'formulaSheet',
        'contentNavigation',
      ])
    })

    it('should place content fields in the Content tab', () => {
      const [contentTab] = getLessonTabs()

      expect(fieldNames(contentTab.fields)).toEqual([
        'chapter',
        'title',
        'course',
        'adminTitle',
        'intro',
        'description',
        'prerequisites',
        'order',
        'prompt',
        'contentFiles',
        'conversionPanel',
        'lessonContextText',
      ])
      expect(findField(contentTab.fields, 'prompt')?.admin?.position).toBeUndefined()
    })

    it('should place exercise fields in the Exercises tab', () => {
      const [, exercisesTab] = getLessonTabs()

      expect(fieldNames(exercisesTab.fields)).toEqual(['blocks', 'contextExerciseViewer'])
    })

    it('should place system fields in the System tab without sidebar positioning', () => {
      const [, , systemTab] = getLessonTabs()

      expect(fieldNames(systemTab.fields)).toEqual([
        'tenant',
        'locale',
        'translatedFrom',
        'accessType',
        'visibleRenderers',
        'slug',
        'status',
        'isActive',
        'contentStatus',
        'contentStatusVisible',
        'contentStatusExpiresAt',
        'contentStatusLabel',
        'createdBy',
      ])
      expect(
        systemTab.fields.every((field) => asInspectableField(field).admin?.position !== 'sidebar'),
      ).toBe(true)
    })
  })
})
