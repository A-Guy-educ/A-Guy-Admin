/**
 * CourseSignups Collection
 *
 * The courses a student has chosen to study (e.g. math + physics + chemistry).
 * `users.currentCourse` stays the single course they are on right now.
 *
 * Deliberately separate from Enrollments: an enrollment row is an access grant
 * (Web's paid-access checks treat any non-cancelled, non-expired row as paid
 * access), so a free sign-up stored there would unlock paid courses.
 * A sign-up grants nothing.
 *
 * @fileType collection-config
 * @domain courses
 * @pattern user-owned
 * @ai-summary One row per user+course the student signed up for; never grants access
 */

import type { Access, CollectionConfig } from 'payload'

import { adminOnly } from '@/server/payload/access/adminOnly'
import { isUsersCollectionUser } from '@/server/payload/access/isUsersCollectionUser'
import { AccountRole } from '@/server/payload/collections/Users/roles'

const adminOrOwnSignup: Access = ({ req: { user } }) => {
  if (!isUsersCollectionUser(user)) return false
  if (user.role === AccountRole.Admin) return true
  return { user: { equals: user.id } }
}

export const CourseSignups: CollectionConfig = {
  slug: 'course-signups',
  admin: {
    useAsTitle: 'id',
    defaultColumns: ['user', 'course', 'createdAt'],
  },
  access: {
    // Writes go through /api/users/me/course-signups, which only accepts
    // published, active courses.
    create: adminOnly,
    read: adminOrOwnSignup,
    update: adminOnly,
    delete: adminOnly,
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      maxDepth: 0,
      admin: {
        description: 'The student who signed up',
      },
    },
    {
      name: 'course',
      type: 'relationship',
      relationTo: 'courses',
      required: true,
      index: true,
      maxDepth: 0,
      admin: {
        description: 'The course the student signed up for',
      },
    },
  ],
  timestamps: true,
  indexes: [
    // Unique constraint: one sign-up per user+course
    { fields: ['user', 'course'], unique: true },
  ],
}
