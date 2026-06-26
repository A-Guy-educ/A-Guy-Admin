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
