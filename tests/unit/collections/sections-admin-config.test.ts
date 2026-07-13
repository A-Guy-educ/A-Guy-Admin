/**
 * @fileType unit-test
 * @domain collections
 * @pattern schema-validation
 * @ai-summary Verifies the Sections collection admin config wires the
 *             ContentNavigation sidebar and uses the auto-populated adminTitle.
 */
import type { Field } from 'payload'
import { describe, expect, it } from 'vitest'
import { Sections } from '@/server/payload/collections/Sections'

type InspectableField = Field & {
  name?: string
  admin?: {
    position?: string
    hidden?: boolean
    components?: { Field?: string }
    description?: string
  }
  fields?: Field[]
  type?: string
}

const asInspectable = (field: Field): InspectableField => field as InspectableField

const collectSidebarFields = (fields: Field[]): InspectableField[] =>
  fields.flatMap((field) => {
    const inspectable = asInspectable(field)
    const current = inspectable.admin?.position === 'sidebar' ? [inspectable] : []
    const nested = inspectable.fields ? collectSidebarFields(inspectable.fields) : []
    const tabFields = (inspectable as InspectableField & { tabs?: Array<{ fields?: Field[] }> })
      .tabs
    const tabsNested = tabFields
      ? tabFields.flatMap((t) => (t.fields ? collectSidebarFields(t.fields) : []))
      : []
    return [...current, ...nested, ...tabsNested]
  })

const findField = (
  fields: Field[],
  predicate: (field: InspectableField) => boolean,
): InspectableField | undefined => {
  for (const field of fields) {
    const inspectable = asInspectable(field)
    if (predicate(inspectable)) return inspectable
    if (inspectable.fields) {
      const nested = findField(inspectable.fields, predicate)
      if (nested) return nested
    }
    const tabFields = (inspectable as InspectableField & { tabs?: Array<{ fields?: Field[] }> })
      .tabs
    if (tabFields) {
      for (const tab of tabFields) {
        if (tab.fields) {
          const nested = findField(tab.fields, predicate)
          if (nested) return nested
        }
      }
    }
  }
  return undefined
}

describe('Sections collection — admin config', () => {
  it('uses adminTitle as the displayed record title and in list search', () => {
    expect(Sections.admin?.useAsTitle).toBe('adminTitle')
    expect(Sections.admin?.listSearchableFields).toEqual(['adminTitle', 'title'])
  })

  it('exposes a hidden adminTitle field on the collection', () => {
    const adminTitle = findField(
      Sections.fields as Field[],
      (field) => field.name === 'adminTitle' && field.type === 'text',
    )
    expect(adminTitle).toBeDefined()
    expect(adminTitle?.admin?.hidden).toBe(true)
  })

  it('renders the SectionNavigation sidebar widget', () => {
    const sidebar = collectSidebarFields(Sections.fields as Field[])
    const nav = sidebar.find((field) => field.name === 'contentNavigation')

    expect(nav).toBeDefined()
    expect(nav?.type).toBe('ui')
    expect(nav?.admin?.components?.Field).toBe('@/ui/admin/ContentNavigation#SectionNavigation')
  })
})
