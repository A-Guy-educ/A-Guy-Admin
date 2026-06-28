/**
 * Features Collection
 *
 * Global catalog of features that products can bundle. One row per feature key.
 * Replaces the closed `FEATURE_KEYS` const array — admins can add features
 * without a code deploy. Product composition references a feature row and
 * supplies its own limit + period overrides.
 *
 * @fileType collection-config
 * @domain billing
 * @pattern catalog, definitions
 * @ai-summary Feature definitions referenced by Product content blocks; carries label, description, type, default period, and enforcement status
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '../access/adminOnly'
import { anyone } from '../access/anyone'
import { createdByField } from '../fields/createdBy'

export const Features: CollectionConfig = {
  slug: 'features',
  access: {
    create: adminOnly,
    update: adminOnly,
    delete: adminOnly,
    read: anyone,
  },
  admin: {
    useAsTitle: 'label',
    defaultColumns: ['key', 'label', 'type', 'enforcement', 'isActive'],
    description:
      'Reusable feature definitions. Bundle into products via the Product "What\'s in this product" blocks.',
    group: 'Payments',
  },
  hooks: {
    beforeChange: [
      ({ data }) => {
        if (!data) return data
        // Normalize key: trim + lowercase. Keys are kebab-case identifiers used
        // by runtime quota consumers — typos here become silent allow-fallthroughs.
        if (typeof data.key === 'string') {
          data.key = data.key.trim().toLowerCase()
        }
        return data
      },
    ],
  },
  fields: [
    {
      name: 'key',
      type: 'text',
      required: true,
      unique: true,
      index: true,
      admin: {
        description:
          'Stable identifier used by runtime gates (e.g. ai-questions). kebab-case, lowercase. Changing this after grants exist will orphan featureEntitlements.',
      },
    },
    {
      name: 'label',
      type: 'text',
      required: true,
      admin: {
        description: 'Human-friendly name shown in the admin feature picker.',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description:
          'What this feature does. Shown next to the picker so admins choose the right one.',
      },
    },
    {
      name: 'type',
      type: 'select',
      required: true,
      defaultValue: 'numeric',
      options: [
        { label: 'Numeric (e.g., 5/day)', value: 'numeric' },
        { label: 'Boolean (on/off)', value: 'boolean' },
      ],
      admin: {
        description:
          'Numeric features carry a limit + period when added to a product; boolean features are simple unlocks.',
      },
    },
    {
      name: 'unit',
      type: 'text',
      admin: {
        description: 'Display hint for the limit (e.g., "questions", "messages"). Numeric only.',
        condition: (data) => data.type === 'numeric',
      },
    },
    {
      name: 'defaultPeriod',
      type: 'select',
      defaultValue: 'day',
      options: [
        { label: 'Day', value: 'day' },
        { label: 'Month', value: 'month' },
        { label: 'Lifetime', value: 'lifetime' },
      ],
      admin: {
        description:
          'Default reset window used when a product adds this feature. Admin can override per-product.',
        condition: (data) => data.type === 'numeric',
      },
    },
    {
      name: 'isSilent',
      type: 'checkbox',
      defaultValue: false,
      admin: {
        description:
          'When on, denials are silent — endpoints return a generic error without revealing the limit (e.g. chat-limit).',
      },
    },
    {
      name: 'enforcement',
      type: 'select',
      required: true,
      defaultValue: 'metadata',
      options: [
        { label: 'Enforced at runtime', value: 'enforced' },
        { label: 'Metadata only (no runtime gate)', value: 'metadata' },
      ],
      admin: {
        description:
          'Whether a runtime consumer reads this feature. "Metadata only" means it appears on entitlements but nothing checks it.',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      defaultValue: true,
      admin: {
        description:
          'Hide from the admin feature picker when off (existing references continue to work).',
      },
    },
    createdByField,
  ],
}
