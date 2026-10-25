/**
 * QuestionAttempts Collection
 *
 * One doc per (user, exercise, block), written by A-Guy-Web with atomic
 * $inc/$set upserts straight to Mongo. Admin only displays it, so create and
 * update are closed here. Web owns the unique (user, exercise, block) index.
 * Slug and field names are a cross-repo contract — do not rename.
 *
 * @fileType collection-config
 * @domain classroom
 * @ai-summary Per-question student attempt counters for the teacher dashboard
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/server/payload/access/adminOnly'
import { normalizeRelationshipIds } from '@/server/payload/hooks/normalizeRelationshipIds'

const counterField = (name: string) =>
  ({
    name,
    type: 'number',
    defaultValue: 0,
    min: 0,
  }) as const

export const QuestionAttempts: CollectionConfig = {
  slug: 'question-attempts',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'lesson', 'block', 'solved', 'wrongCount', 'hintCount'],
    group: 'Classroom',
  },
  access: {
    create: () => false,
    read: adminOnly,
    update: () => false,
    delete: adminOnly,
  },
  hooks: {
    afterRead: [normalizeRelationshipIds(['tenant', 'user', 'lesson', 'exercise'])],
  },
  fields: [
    {
      name: 'tenant',
      type: 'relationship',
      relationTo: 'tenants',
      index: true,
      admin: { position: 'sidebar' },
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
    },
    {
      name: 'lesson',
      type: 'relationship',
      relationTo: 'lessons',
      required: true,
      index: true,
    },
    {
      name: 'exercise',
      type: 'relationship',
      relationTo: 'exercises',
      required: true,
    },
    {
      name: 'block',
      type: 'text',
      required: true,
      admin: { description: 'Question block ID within the exercise' },
    },
    {
      name: 'solved',
      type: 'checkbox',
      defaultValue: false,
    },
    counterField('wrongCount'),
    counterField('hintCount'),
    counterField('explanationCount'),
    {
      name: 'firstAttemptAt',
      type: 'date',
    },
    {
      name: 'solvedAt',
      type: 'date',
    },
  ],
  timestamps: true,
}
