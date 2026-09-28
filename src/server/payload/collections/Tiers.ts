/**
 * Tiers Collection
 *
 * Subscription tier catalog. A Tier is a marketing/rank abstraction: it
 * names a level of access ("Free", "Basic", "Pro", "Elite") and carries a
 * numeric `rank` so runtime gates can express "at least Pro" as a `>=`
 * comparison. The concrete permissions a tier grants (which courses, which
 * feature caps, which UI views) are attached in a later phase — this file
 * only defines the tier entity itself.
 *
 * Products link to exactly one Tier via `Products.tier`; purchasing a
 * Product promotes the user to that Tier (highest-rank wins if multiple
 * grants are active). The Free tier is the fallback for users with no
 * active paid grants and is marked `isDefault: true`.
 *
 * @fileType collection-config
 * @domain billing
 * @pattern catalog, rank-ordered
 * @ai-summary Named subscription tiers with numeric rank; permissions attach later
 */
import type { CollectionConfig } from 'payload'

import { adminOnly } from '../access/adminOnly'
import { anyone } from '../access/anyone'
import { createdByField } from '../fields/createdBy'

export const Tiers: CollectionConfig = {
  slug: 'tiers',
  access: {
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
    read: anyone,
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['slug', 'rank', 'name', 'isDefault', 'isActive'],
    description:
      'Subscription tiers. Every Product links to one Tier; buying the Product promotes the user to that Tier (highest rank wins on overlap).',
    group: 'Payments',
  },
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (!data) return data
        if (typeof data.slug === 'string') {
          data.slug = data.slug.trim().toLowerCase()
        }
        return data
      },
    ],
    beforeValidate: [
      async ({ data, req, originalDoc, operation }) => {
        if (!data) return data
        // At most one Tier may carry isDefault=true (the Free fallback).
        // This app-level check produces a friendly error naming the
        // offending row. It has a TOCTOU window that is closed by the
        // partial unique index on tiers.isDefault (see the
        // ensureTiersIndexes migration, run at onInit) — that index is
        // the actual race-proof enforcement; this check is UX polish.
        if (data.isDefault === true) {
          const existing = await req.payload.find({
            collection: 'tiers',
            where: { isDefault: { equals: true } },
            limit: 2,
            depth: 0,
            overrideAccess: true,
            req,
          })
          const otherDefault = existing.docs.find(
            (d) => operation === 'create' || d.id !== originalDoc?.id,
          )
          if (otherDefault) {
            throw new Error(
              `Another tier is already marked as default: "${(otherDefault as { slug?: string }).slug ?? otherDefault.id}". Unset it before marking this tier as default.`,
            )
          }
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description:
          'Stable identifier used by runtime code (e.g. "free", "basic", "pro", "elite"). kebab-case, lowercase. Changing this after grants exist orphans user.currentTier references.',
      },
    },
    {
      name: 'rank',
      type: 'number',
      required: true,
      index: true,
      min: 0,
      admin: {
        description:
          'Numeric level for "higher includes lower" comparisons. Free = 0, top tier gets the largest number. Ranks should be unique but the schema does not enforce it — allowing a temporary duplicate is the only way to reorder tiers via two individual writes. Ties resolve arbitrarily but deterministically in the recompute helper.',
      },
    },
    {
      name: 'name',
      type: 'text',
      required: true,
      localized: true,
      admin: {
        description: 'Display name (localized, EN + HE).',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      localized: true,
      admin: {
        description: 'Marketing copy shown on the pricing page (localized).',
      },
    },
    {
      name: 'isDefault',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'Fallback tier assigned to users with no active paid grants. Exactly one tier should have this on (Free).',
      },
    },
    {
      name: 'color',
      type: 'text',
      admin: {
        description: 'Hex badge colour used in the admin + pricing UI (e.g. #4F46E5).',
      },
    },
    {
      name: 'sortOrder',
      type: 'number',
      defaultValue: 0,
      admin: {
        description: 'Display order on the pricing page (ascending).',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description:
          'When off, the tier is hidden from the pricing page. Existing grants remain valid.',
      },
    },
    createdByField,
  ],
}
