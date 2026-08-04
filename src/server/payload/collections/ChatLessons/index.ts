/**
 * @fileType collection-config
 * @domain chat-lessons
 * @ai-summary Authored chat-lesson scripts, one doc per (lesson, locale).
 *             Read at request time by the Web repo's ChatLessonView. See
 *             `A-Guy-Web/src/lib/chat-lessons/payload-chat-script.ts` for
 *             the runtime contract — keep the two in lockstep.
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '../../access/adminOnly'
import { publishedAndActive } from '../../access/publishedAndActive'
import { contentLocaleField } from '@/server/payload/fields/contentLocale'
import { contentStatusFields } from '@/server/payload/fields/contentStatus'
import { tenantField } from '@/server/payload/fields/tenant'
import { chatLessonStepBlocks } from './blocks'
import { validateChatLessonSteps } from './validate-steps'

export const ChatLessons: CollectionConfig = {
  slug: 'chat-lessons',
  access: {
    create: adminOnly,
    delete: adminOnly,
    // Students / anon can read the script for a published lesson so the
    // Chat tab renders on Web. `publishedAndActive` gates on the doc's own
    // status; we mirror the Lessons pattern to keep review straightforward.
    read: publishedAndActive,
    update: adminOnly,
  },
  admin: {
    useAsTitle: 'lesson',
    defaultColumns: ['lesson', 'locale', 'status', 'isActive', 'contentStatus', 'updatedAt'],
    group: 'Content',
    description: 'Authored scripts powering the Chat tab of a lesson.',
  },
  // Composite uniqueness: at most one script per lesson per locale.
  indexes: [
    {
      fields: ['lesson', 'locale'],
      unique: true,
    },
  ],
  hooks: {
    beforeChange: [validateChatLessonSteps],
  },
  fields: [
    {
      name: 'lesson',
      type: 'relationship',
      relationTo: 'lessons',
      required: true,
      index: true,
      admin: {
        description: 'The lesson this chat script belongs to.',
      },
    },
    {
      name: 'highlights',
      type: 'textarea',
      admin: {
        description: 'Optional short blurb shown on the start card.',
      },
    },
    {
      name: 'steps',
      type: 'blocks',
      required: true,
      minRows: 1,
      blocks: chatLessonStepBlocks,
      admin: {
        description:
          'Ordered list of steps that make up the chat script. Must contain exactly one `finish` step, reachable from the first step.',
      },
    },
    {
      name: 'status',
      type: 'select',
      required: true,
      index: true,
      defaultValue: 'draft',
      options: [
        { label: 'Draft', value: 'draft' },
        { label: 'Published', value: 'published' },
        { label: 'Archived', value: 'archived' },
      ],
      admin: {
        position: 'sidebar',
        description: 'Publication status of the chat script.',
      },
    },
    {
      name: 'isActive',
      type: 'checkbox',
      required: true,
      defaultValue: true,
      admin: {
        position: 'sidebar',
        description: 'Whether this chat script is currently active.',
      },
    },
    // Standard content-visibility fields — required so the Web-side
    // `visibleContentFilter` (status + isActive + contentStatus/Visible) can
    // resolve chat scripts the same way it resolves lessons and chapters.
    // Without these, the Web query never matches and the Chat tab falls back
    // to the bundled demo. Mirrors the pattern in Lessons.ts / Chapters.ts.
    ...contentStatusFields,
    tenantField,
    contentLocaleField,
  ],
}
