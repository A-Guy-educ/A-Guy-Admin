/**
 * UserLearningStates Collection
 *
 * Per-student exercise / lesson-chat progress and exam dates kept server-side so it follows
 * the student across shared school computers. A-Guy-Web reads and writes this
 * collection directly in Mongo (same as `user-progresses`) and upserts on
 * { user, kind, key }; Admin only owns the schema, indexes and CMS view.
 *
 * @fileType collection-config
 * @domain progress-tracking
 * @pattern user-owned, cross-repo-contract
 * @ai-summary Opaque per-user exercise, lesson-chat and exam-date state, written by Web
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/server/payload/access/adminOnly'
import { authenticatedOrOwner } from '@/server/payload/access/authenticatedOrOwner'
import { tenantField } from '@/server/payload/fields/tenant'

export const UserLearningStates: CollectionConfig = {
  slug: 'user-learning-states',
  // Web targets this exact Mongo collection name — don't rely on pluralisation.
  dbName: 'user-learning-states',
  access: {
    // Web bypasses Payload, so only admins write through the CMS.
    create: adminOnly,
    read: authenticatedOrOwner,
    update: adminOnly,
    delete: adminOnly,
  },
  admin: {
    useAsTitle: 'key',
    defaultColumns: ['user', 'kind', 'key', 'updatedAt'],
  },
  indexes: [
    // Web upserts on exactly this filter; uniqueness stops concurrent first
    // writes from creating duplicates.
    { fields: ['user', 'kind', 'key'], unique: true },
  ],
  fields: [
    // Tenant
    tenantField,
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      admin: {
        description: 'The student this state belongs to',
      },
    },
    {
      name: 'kind',
      type: 'select',
      required: true,
      options: [
        { label: 'Exercise', value: 'exercise' },
        { label: 'Lesson chat', value: 'lesson-chat' },
        // state: { exams: [{ id, date: 'YYYY-MM-DD', label? }] }
        { label: 'Exam dates', value: 'exam-dates' },
      ],
    },
    {
      name: 'key',
      type: 'text',
      required: true,
      admin: {
        description:
          'Exercise id, `review-<exerciseId>`, lesson id, or (exam-dates) course id / `default-course`',
      },
    },
    {
      // Opaque bundle owned by Web (answers, check results, walker cursor, percent…).
      name: 'state',
      type: 'json',
    },
  ],
  timestamps: true,
}
