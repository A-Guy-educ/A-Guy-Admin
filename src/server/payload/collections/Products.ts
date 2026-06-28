/**
 * Products Collection
 *
 * @fileType collection-config
 * @domain billing
 * @pattern composable-bundle
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '../access/adminOnly'
import { anyone } from '../access/anyone'
import { createdByField } from '../fields/createdBy'
import { formatSlugAsync } from '../fields/formatSlug'
import { optionalTenantField } from '../fields/tenant'

export const Products: CollectionConfig = {
  slug: 'products',
  access: {
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
    read: anyone,
  },
  hooks: {
    beforeValidate: [
      async ({ data, req }) => {
        if (!data?.contents || !Array.isArray(data.contents)) return data
        // Validate featureBlock invariants against the referenced Feature row.
        // Numeric features REQUIRE a limit (otherwise the runtime quota
        // checker returns allowed: true / Infinity — a silent unlimited
        // grant). Boolean features should not carry a meaningful limit or
        // a non-default period; reject both to prevent confusing data and
        // misleading admin UI.
        for (const block of data.contents as Array<Record<string, unknown>>) {
          if (block?.blockType !== 'featureBlock') continue
          const featureRef = block.feature
          if (!featureRef) continue // required-field check handles this

          const featureId =
            typeof featureRef === 'string' ? featureRef : (featureRef as { id?: string }).id
          if (!featureId) continue

          let featureType: string | null = null
          if (typeof featureRef === 'object' && 'type' in featureRef) {
            featureType = (featureRef as { type?: string }).type ?? null
          }
          if (!featureType) {
            try {
              const fetched = await req.payload.findByID({
                collection: 'features',
                id: featureId,
                depth: 0,
                overrideAccess: true,
                req,
              })
              featureType = (fetched as { type?: string })?.type ?? null
            } catch {
              // Missing Feature row — surface as a different error so the
              // admin sees "feature not found" rather than a confusing
              // limit/period validation.
              throw new Error(`featureBlock points at a missing Feature (${featureId}).`)
            }
          }

          const limit = block.limit
          const period = block.period

          if (featureType === 'numeric') {
            if (typeof limit !== 'number') {
              throw new Error(
                'featureBlock: numeric feature requires a limit. Without one, the runtime grants unlimited usage.',
              )
            }
          } else if (featureType === 'boolean') {
            if (typeof limit === 'number') {
              throw new Error(
                'featureBlock: boolean feature must not have a limit. Limits only make sense for numeric features.',
              )
            }
            if (typeof period === 'string' && period && period !== 'lifetime') {
              throw new Error(
                'featureBlock: boolean feature cannot have a per-day/per-month period. Boolean features are simple unlocks.',
              )
            }
          }
        }
        return data
      },
    ],
    beforeChange: [
      async ({ data, operation, originalDoc, req }) => {
        if (!data) return data

        if (operation === 'update' && originalDoc?.slug) {
          data.slug = data.slug?.trim()
          return data
        }

        if (data.name && !data.slug) {
          const baseSlug = await formatSlugAsync(data.name)
          let slug = baseSlug
          let counter = 1
          const MAX = 100

          for (let attempt = 0; attempt < MAX; attempt++) {
            const existing = await req.payload.find({
              collection: 'products',
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

          data.slug = `${baseSlug}-${Date.now().toString(36)}`
        }

        return data
      },
    ],
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'billingType', 'interval', 'price', 'currency', 'isActive'],
    components: {
      views: {
        edit: {
          Default: {
            Component: '@/ui/admin/Products/EditView#ProductsEditView',
          },
        },
      },
      edit: {
        SaveButton: '@/ui/admin/Products/SaveButton#ProductsSaveButton',
      },
    },
  },
  fields: [
    // Tenant (optional - null/empty means global/legacy product accessible to all)
    optionalTenantField,
    {
      name: 'name',
      type: 'text',
      required: true,
      admin: {
        description: 'שם המוצר (יוצג למשתמשים)',
      },
    },
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description: 'מזהה ייחודי (URL-friendly, נוצר אוטומטית מהשם)',
        position: 'sidebar',
      },
    },
    {
      name: 'billingType',
      type: 'select',
      required: true,
      options: [
        { label: 'חד-פעמי', value: 'one_time' },
        { label: 'מנוי', value: 'subscription' },
      ],
      admin: {
        description: 'סוג החיוב: חד-פעמי או מנוי חוזר',
      },
    },
    {
      name: 'interval',
      type: 'select',
      options: [
        { label: 'חודש', value: 'month' },
        { label: 'שנה', value: 'year' },
      ],
      admin: {
        description: 'מרווח החיוב (למנוי בלבד)',
        condition: (data) => data.billingType === 'subscription',
      },
      validate: (value: unknown, { data }: { data: Record<string, unknown> }) => {
        if (data?.billingType === 'subscription' && !value) {
          return 'מרווח החיוב נדרש עבור מנוי'
        }
        return true
      },
    },
    {
      name: 'price',
      type: 'number',
      required: true,
      min: 0,
      admin: {
        description: 'מחיר המוצר',
      },
    },
    {
      name: 'currency',
      type: 'select',
      required: true,
      defaultValue: 'ILS',
      options: [
        { label: 'ILS (שקל)', value: 'ILS' },
        { label: 'USD (דולר)', value: 'USD' },
        { label: 'EUR (אירו)', value: 'EUR' },
      ],
      admin: {
        description: 'מטבע התשלום',
      },
    },
    {
      name: 'durationDays',
      type: 'number',
      min: 1,
      admin: {
        description:
          'תקופת גישה בימים מרגע הרכישה (השאר ריק לגישה ללא הגבלת זמן). מוחל אוטומטית על Enrollments בעת רכישה.',
      },
    },
    {
      name: 'maxDevices',
      type: 'number',
      min: 1,
      admin: {
        description:
          'מספר מקסימלי של מכשירים למשתמש (השאר ריק = ללא הגבלה). שדה לתצורה בלבד — האכיפה אינה מיושמת.',
      },
    },
    {
      name: 'contents',
      type: 'blocks',
      labels: {
        singular: 'בלוק תוכן',
        plural: 'בלוקי תוכן',
      },
      admin: {
        description:
          'מה כלול במוצר. הוסף בלוקים של גישה לקורס ושל תכונות. ניתן לגרור כדי לסדר מחדש.',
      },
      blocks: [
        {
          slug: 'courseBlock',
          labels: {
            singular: '🎓 גישה לקורס',
            plural: '🎓 גישת קורסים',
          },
          fields: [
            {
              name: 'course',
              type: 'relationship',
              relationTo: 'courses',
              required: true,
              admin: {
                description: 'הקורס שהקונה מקבל גישה אליו',
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
                description:
                  'סוגי שיעורים שייכללו (השאר ריק = כל הסוגים). ⚠️ מטא־דאטה בלבד — Enrollments מעניק גישה לקורס כולו.',
              },
            },
          ],
        },
        {
          slug: 'featureBlock',
          labels: {
            singular: '⚙️ תכונה',
            plural: '⚙️ תכונות',
          },
          fields: [
            {
              name: 'feature',
              type: 'relationship',
              relationTo: 'features',
              required: true,
              admin: {
                description: 'בחר תכונה מהקטלוג. אם חסרה — הוסף ב־Features.',
              },
            },
            {
              name: 'limit',
              type: 'number',
              min: 0,
              admin: {
                description:
                  'מגבלה מספרית (לדוגמה: 5). השאר ריק לתכונה ללא מגבלת כמות / לתכונה בוליאנית.',
              },
            },
            {
              name: 'period',
              type: 'select',
              // No defaultValue: a boolean feature gets auto-rejected by the
              // beforeValidate hook if period defaults to 'day', forcing the
              // admin to clear the field manually. The grant code's fallback
              // ladder (block.period → feature.defaultPeriod → 'lifetime')
              // supplies a safe default when this is unset.
              options: [
                { label: 'יומי', value: 'day' },
                { label: 'לכל החיים', value: 'lifetime' },
              ],
              admin: {
                description: 'תקופת איפוס המגבלה (רלוונטי רק לתכונות עם limit).',
              },
            },
          ],
        },
      ],
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description: 'האם המוצר פעיל וזמין למכירה',
      },
    },
    // Created By
    createdByField,
  ],
}
