/**
 * CourseSelections Collection
 * Logs every course selection event from the web (authenticated or anonymous).
 *
 * @fileType collection-config
 * @domain analytics
 * @pattern event-tracking, anonymous-friendly
 * @ai-summary Server-side record of every user/anonymous course pick on start page,
 *   homepage greeting, or course card. Fire-and-forget from the client.
 *
 * Privacy: IP and User-Agent are SHA-256 hashed server-side and stored only as
 * truncated fingerprints. No raw IP/UA ever leaves the request handler.
 */
import type { Access, CollectionConfig } from 'payload'

import { adminOnly } from '@/server/payload/access/adminOnly'

export const COURSE_SELECTION_SOURCES = [
  'start-page',
  'homepage-greeting',
  'course-card',
  'other',
] as const

const adminOnlyRead: Access = ({ req }) => adminOnly({ req })

export const CourseSelections: CollectionConfig = {
  slug: 'course-selections',
  dbName: 'course_selections',
  admin: {
    useAsTitle: 'id',
    group: 'System',
    description: 'Server-side log of every course pick (anonymous or authenticated)',
    defaultColumns: ['course', 'user', 'guestId', 'source', 'gradeLevel', 'createdAt'],
  },
  access: {
    create: () => true,
    read: adminOnlyRead,
    update: adminOnlyRead,
    delete: adminOnlyRead,
  },
  fields: [
    {
      name: 'course',
      type: 'relationship',
      relationTo: 'courses',
      required: true,
      index: true,
      admin: {
        description: 'The course that was selected',
      },
    },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      index: true,
      admin: {
        description: 'The user who made the selection (null for anonymous guests)',
      },
    },
    {
      name: 'guestId',
      type: 'text',
      index: true,
      admin: {
        description: 'Opaque client-generated ID for anonymous users (lets us count unique guests)',
      },
    },
    {
      name: 'gradeLevel',
      type: 'text',
      admin: {
        description: 'Grade level reported by the client (mirrors LocalUserProfile on web)',
      },
    },
    {
      name: 'source',
      type: 'select',
      required: true,
      options: [
        { label: 'Start Page', value: 'start-page' },
        { label: 'Homepage Greeting', value: 'homepage-greeting' },
        { label: 'Course Card', value: 'course-card' },
        { label: 'Other', value: 'other' },
      ],
      index: true,
      admin: {
        description: 'Where in the UI the selection originated',
      },
    },
    {
      name: 'userAgentHash',
      type: 'text',
      admin: {
        hidden: true,
        description: 'SHA-256 (truncated) of the request User-Agent — computed server-side',
      },
    },
    {
      name: 'ipHash',
      type: 'text',
      admin: {
        hidden: true,
        description: 'SHA-256 (truncated) of the request IP — computed server-side',
      },
    },
  ],
  timestamps: true,
}
