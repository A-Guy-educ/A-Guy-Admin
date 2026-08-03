/**
 * @fileType unit-test
 * @domain collections
 * @pattern schema-validation
 * @ai-summary Verifies the Exercises collection admin config exposes the
 *             expected top-level tabs (Content, Sections Quick, Sections,
 *             System) and that the sectionRef playlist field `blocks` lives
 *             in the Sections Quick tab.
 */
import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { Exercises } from '@/server/payload/collections/Exercises/index'
import { Lessons } from '@/server/payload/collections/Lessons'

type TabConfig = {
  label?: string
  name?: string
  fields: Field[]
}

type InspectableField = Field & {
  name?: string
  type?: string
  tabs?: TabConfig[]
  fields?: Field[]
  admin?: {
    components?: { Field?: string }
  }
}

const asInspectableField = (field: Field): InspectableField => field as InspectableField

const getTabsField = (fields: Field[]) => {
  const field = fields.find((item) => asInspectableField(item).type === 'tabs')
  expect(field).toBeDefined()
  return asInspectableField(field as Field)
}

const getTabs = (fields: Field[]) => {
  const tabs = getTabsField(fields).tabs
  expect(tabs).toBeDefined()
  return tabs as TabConfig[]
}

const fieldNames = (fields: Field[]) => fields.map((field) => asInspectableField(field).name)

describe('Exercises Collection Config — admin tabs', () => {
  it('should render four tabs in the order Content, Sections Quick, Sections, System', () => {
    const tabs = getTabs(Exercises.fields as Field[])

    expect(tabs.map((tab) => tab.label)).toEqual([
      'Content',
      'Sections Quick',
      'Sections',
      'System',
    ])
  })

  it('should place the sectionRef playlist (blocks) in the Sections Quick tab', () => {
    const [, quickTab] = getTabs(Exercises.fields as Field[])

    expect(fieldNames(quickTab.fields)).toEqual(['blocks'])
    const blocks = asInspectableField(quickTab.fields[0])
    expect(blocks).toMatchObject({
      name: 'blocks',
      type: 'textarea',
    })
    expect(blocks.admin?.components?.Field).toBe(
      '@/ui/admin/ExerciseBlocksField#ExerciseBlocksField',
    )
  })

  it('should render the full-view Sections tab via ExerciseBlocksFullField', () => {
    const [, , sectionsTab] = getTabs(Exercises.fields as Field[])

    expect(sectionsTab.label).toBe('Sections')
    expect(fieldNames(sectionsTab.fields)).toEqual(['blocksFullView'])
    const uiField = asInspectableField(sectionsTab.fields[0])
    expect(uiField.type).toBe('ui')
    expect(uiField.admin?.components?.Field).toBe(
      '@/ui/admin/ExerciseBlocksField#ExerciseBlocksFullField',
    )
  })

  it('should not place the blocks field in the System tab', () => {
    const tabs = getTabs(Exercises.fields as Field[])
    const systemTab = tabs[tabs.length - 1]
    expect(systemTab.label).toBe('System')

    expect(fieldNames(systemTab.fields)).not.toContain('blocks')
    expect(fieldNames(systemTab.fields)).toContain('lesson')
    expect(fieldNames(systemTab.fields)).toContain('course')
    expect(fieldNames(systemTab.fields)).toContain('showQuestionNumbering')
  })

  it('should expose the Exercises and Exercises Quick tabs on Lessons', () => {
    const lessonTabs = getTabs(Lessons.fields as Field[])

    expect(lessonTabs.map((tab) => tab.label)).toEqual([
      'Content',
      'Exercises',
      'Exercises Quick',
      'System',
      'SEO',
    ])
    const [, exercisesTab, exercisesQuickTab] = lessonTabs
    expect(fieldNames(exercisesTab.fields)).toEqual(['blocks', 'contextExerciseViewer'])
    expect(fieldNames(exercisesQuickTab.fields)).toEqual(['blocksQuickView'])
    const quickField = asInspectableField(exercisesQuickTab.fields[0])
    expect(quickField.type).toBe('ui')
    expect(quickField.admin?.components?.Field).toBe(
      '@/ui/admin/LessonBlocksField#LessonBlocksQuickField',
    )
  })
})
