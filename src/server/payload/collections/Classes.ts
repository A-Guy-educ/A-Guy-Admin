/**
 * Classes Collection
 *
 * A school class (e.g. "י'3 מתקדם") studying one course, with its teachers and
 * students. A-Guy-Web reads this directly from Mongo for the teacher dashboard
 * and for /join self-enrollment, which lists `schools.name` + classes by `name`,
 * `school`, `course`, and $push-es the joining user's ObjectId onto `students`.
 * `hiddenLessons` is also part of the Web contract: Web owns its writes ($addToSet /
 * $pull of lesson ObjectIds when a teacher hides lessons from the class's students).
 * Slug and field names are a cross-repo contract — do not rename. Admin saves
 * keep students who joined while the class was open (see preserveConcurrentStudents)
 * and never overwrite hiddenLessons (see preserveHiddenLessons).
 *
 * @fileType collection-config
 * @domain classroom
 * @ai-summary Classes linking a school + course to teacher and student users
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '@/server/payload/access/adminOnly'
import { AccountRole } from '@/server/payload/collections/Users/roles'
import { tenantField } from '@/server/payload/fields/tenant'
import {
  loadedStudentsField,
  preserveConcurrentStudents,
} from '@/server/payload/hooks/classes/preserveConcurrentStudents'
import { preserveHiddenLessons } from '@/server/payload/hooks/classes/preserveHiddenLessons'
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
    beforeChange: [preserveConcurrentStudents, preserveHiddenLessons],
    afterRead: [
      normalizeRelationshipIds([
        'school',
        'course',
        'teachers',
        'students',
        'hiddenLessons',
        'tenant',
      ]),
    ],
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
    {
      name: 'hiddenLessons',
      type: 'relationship',
      relationTo: 'lessons',
      hasMany: true,
      admin: {
        readOnly: true,
        description:
          "Set by the class teachers in the teacher app. Lessons hidden from this class's students.",
      },
    },
    loadedStudentsField,
    tenantField,
  ],
  timestamps: true,
}
