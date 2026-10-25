/**
 * Schools Collection
 *
 * Schools that host classroom classes. Created by hand in the CMS for the
 * teacher dashboard POC (teacher.aguy.co.il).
 *
 * @fileType collection-config
 * @domain classroom
 * @ai-summary Schools that own classes taught by teachers
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/server/payload/access/adminOnly'
import { tenantField } from '@/server/payload/fields/tenant'
import { normalizeRelationshipIds } from '@/server/payload/hooks/normalizeRelationshipIds'

export const Schools: CollectionConfig = {
  slug: 'schools',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'tenant'],
    group: 'Classroom',
  },
  access: {
    create: adminOnly,
    read: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  hooks: {
    afterRead: [normalizeRelationshipIds(['tenant'])],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    tenantField,
  ],
  timestamps: true,
}
