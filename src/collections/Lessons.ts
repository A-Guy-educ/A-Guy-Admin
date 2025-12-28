import type { CollectionConfig } from 'payload'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'

export const Lessons: CollectionConfig = {
  slug: 'lessons',
  access: {
    create: authenticated,
    delete: authenticated,
    read: anyone,
    update: authenticated,
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['course', 'title', 'order', 'status', 'isActive', 'updatedAt'],
  },
  fields: [
    {
      name: 'course',
      type: 'relationship',
      relationTo: 'courses',
      required: true,
      index: true,
      admin: {
        description: 'The course this lesson belongs to',
      },
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      index: true,
      admin: {
        description: 'Lesson title',
      },
    },
    {
      name: 'description',
      type: 'textarea',
      admin: {
        description: 'Detailed description of the lesson',
      },
    },
    {
      name: 'order',
      type: 'number',
      required: true,
      defaultValue: 0,
      min: 0,
      admin: {
        description: 'Sort order within the course',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'draft',
      options: [
        {
          label: 'Draft',
          value: 'draft',
        },
        {
          label: 'Published',
          value: 'published',
        },
        {
          label: 'Archived',
          value: 'archived',
        },
      ],
      admin: {
        description: 'Publication status of the lesson',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      admin: {
        description: 'Whether this lesson is currently active',
      },
    },
  ],
}
