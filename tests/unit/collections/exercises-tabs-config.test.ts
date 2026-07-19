/**
 * @fileType unit-test
 * @domain collections
 * @pattern schema-validation
 * @ai-summary Verifies the Exercises collection admin config exposes three
 *             top-level tabs (Content, Sections, System) and that the
 *             sectionRef playlist field `blocks` lives in the Sections tab.
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
  it('should render three tabs in the order Content, Sections, System', () => {
    const tabs = getTabs(Exercises.fields as Field[])

    expect(tabs.map((tab) => tab.label)).toEqual(['Content', 'Sections', 'System'])
  })

  it('should place the sectionRef playlist (blocks) in the Sections tab', () => {
    const [, sectionsTab] = getTabs(Exercises.fields as Field[])

    expect(fieldNames(sectionsTab.fields)).toEqual(['blocks'])
    const blocks = asInspectableField(sectionsTab.fields[0])
    expect(blocks).toMatchObject({
      name: 'blocks',
      type: 'textarea',
    })
    expect(blocks.admin?.components?.Field).toBe(
      '@/ui/admin/ExerciseBlocksField#ExerciseBlocksField',
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

  it('should keep the Lessons Exercises tab structure unchanged (regression check)', () => {
    const lessonTabs = getTabs(Lessons.fields as Field[])

    expect(lessonTabs.map((tab) => tab.label)).toEqual(['Content', 'Exercises', 'System', 'SEO'])
    const [, exercisesTab] = lessonTabs
    expect(fieldNames(exercisesTab.fields)).toEqual(['blocks', 'contextExerciseViewer'])
  })
})
