/**
 * ProductItems Collection
 *
 * @fileType collection-config
 * @domain billing
 * @pattern conditional-fields, discriminated-union
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '../access/adminOnly'
import { anyone } from '../access/anyone'
import { createdByField } from '../fields/createdBy'
import { FEATURE_KEYS, type FeatureKey } from '@/lib/products/feature-keys'

const VALID_FEATURE_KEYS = FEATURE_KEYS

export const ProductItems: CollectionConfig = {
  slug: 'product-items',
  access: {
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
    read: anyone,
  },
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['type', 'lesson', 'featureKey', 'isHighlighted'],
  },
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (!data) return data
        const type = data.type
        // Cross-type field integrity: reject meaningful values for fields that
        // belong to a different `type`. Per-field `validate` cannot catch this
        // reliably because Payload may strip conditional field data before
        // validation runs. This hook sees the raw input.
        if (type !== 'course') {
          if (Array.isArray(data.lessonTypes) && data.lessonTypes.length > 0) {
            throw new Error('lessonTypes is only valid when type is course')
          }
        }
        if (type !== 'feature') {
          if (typeof data.value === 'number') {
            throw new Error('value is only valid when type is feature')
          }
          // 'lifetime' is the field-level default and is allowed on any type
          // (Payload applies the default to every doc regardless of `condition`).
          // Reject only meaningful mismatches like period='day' on a lesson item.
          if (typeof data.period === 'string' && data.period && data.period !== 'lifetime') {
            throw new Error('period is only valid when type is feature')
          }
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'type',
      type: 'select',
      required: true,
      options: [
        { label: '📚 שיעור', value: 'lesson' },
        { label: '🎓 קורס', value: 'course' },
        { label: '⚙️ תכונה', value: 'feature' },
      ],
      admin: {
        description: 'בחר את סוג הפריט: שיעור בודד, קורס שלם, או תכונה מוגדרת',
        components: {
          Cell: '@/ui/admin/ProductItems/TypeBadgeCell#TypeBadgeCell',
        },
      },
    },
    {
      name: 'lesson',
      type: 'relationship',
      relationTo: 'lessons',
      admin: {
        description: 'בחר את השיעור להוספה למוצר',
        condition: (data) => data.type === 'lesson',
      },
      validate: (value: unknown, { data }: { data: Record<string, unknown> }) => {
        if (data?.type === 'lesson' && !value) return 'Lesson is required when type is lesson'
        return true
      },
    },
    {
      name: 'course',
      type: 'relationship',
      relationTo: 'courses',
      admin: {
        description: 'בחר את הקורס. כל השיעורים בקורס ייכללו (מסוננים לפי lessonTypes אם הוגדר)',
        condition: (data) => data.type === 'course',
      },
      validate: (value: unknown, { data }: { data: Record<string, unknown> }) => {
        if (data?.type === 'course' && !value) return 'Course is required when type is course'
        return true
      },
    },
    {
      name: 'lessonTypes',
      type: 'select',
      hasMany: true,
      options: [
        { label: 'לימוד', value: 'learning' },
        { label: 'תרגול', value: 'practice' },
        { label: 'בחינה', value: 'exam' },
      ],
      admin: {
        description: 'סוגי שיעורים שייכללו (השאר ריק = כל הסוגים)',
        condition: (data) => data.type === 'course',
      },
    },
    {
      name: 'featureKey',
      type: 'text',
      required: true,
      admin: {
        description: 'מזהה התכונה (לדוגמה: certificate, live-sessions)',
        condition: (data) => data.type === 'feature',
      },
      validate: (value: unknown, { data }: { data: Record<string, unknown> }) => {
        if (data?.type !== 'feature') return true
        if (typeof value !== 'string' || !value)
          return 'Feature key is required when type is feature'
        if (!(VALID_FEATURE_KEYS as readonly string[]).includes(value as FeatureKey)) {
          return `Invalid feature key. Valid values: ${VALID_FEATURE_KEYS.join(', ')}`
        }
        return true
      },
    },
    {
      name: 'value',
      type: 'number',
      min: 0,
      admin: {
        description: 'ערך מספרי לתכונה (לדוגמה: 5 עבור 5 שאלות ביום). השאר ריק לתכונה ללא מגבלת כמות.',
        condition: (data) => data.type === 'feature',
      },
    },
    {
      name: 'period',
      type: 'select',
      defaultValue: 'lifetime',
      options: [
        { label: 'יומי', value: 'day' },
        { label: 'חודשי', value: 'month' },
        { label: 'לכל החיים', value: 'lifetime' },
      ],
      admin: {
        description: 'תקופת איפוס המגבלה. ברירת מחדל "לכל החיים" עבור תכונות ללא מגבלת זמן.',
        condition: (data) => data.type === 'feature',
      },
    },
    {
      name: 'isHighlighted',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description: 'סמן אם יש להדגיש פריט זה בממשק המשתמש',
      },
    },
    // Created By
    createdByField,
  ],
}
