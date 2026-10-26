/**
 * Classes Collection
 *
 * A school class (e.g. "י'3 מתקדם") studying one course, with its teachers and
 * students. A-Guy-Web reads this directly from Mongo for the teacher dashboard,
 * so slug and field names are a cross-repo contract — do not rename.
 *
 * @fileType collection-config
 * @domain classroom
 * @ai-summary Classes linking a school + course to teacher and student users
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/server/payload/access/adminOnly'
import { AccountRole } from '@/server/payload/collections/Users/roles'
import { tenantField } from '@/server/payload/fields/tenant'
import { normalizeRelationshipIds } from '@/server/payload/hooks/normalizeRelationshipIds'

export const Classes: CollectionConfig = {
  slug: 'classes',
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'school', 'course'],
    group: 'Classroom',
  },
  access: {
    create: adminOnly,
    read: adminOnly,
    update: adminOnly,
    delete: adminOnly,
  },
  hooks: {
    afterRead: [normalizeRelationshipIds(['school', 'course', 'teachers', 'students', 'tenant'])],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
    },
    {
      name: 'school',
      type: 'relationship',
      relationTo: 'schools',
      required: true,
      index: true,
    },
    {
      name: 'course',
      type: 'relationship',
      relationTo: 'courses',
      required: true,
      index: true,
    },
    {
      name: 'teachers',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      index: true,
      filterOptions: {
        role: { in: [AccountRole.Teacher, AccountRole.Admin] },
      },
    },
    {
      name: 'students',
      type: 'relationship',
      relationTo: 'users',
      hasMany: true,
      index: true,
    },
    tenantField,
  ],
  timestamps: true,
}
