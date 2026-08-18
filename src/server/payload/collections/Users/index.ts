/**
 * Users Collection
 *
 * @fileType collection-config
 * @domain auth
 * @pattern rbac, user-owned
 * @ai-summary Users collection with authentication, RBAC roles, and audit hooks
 */

import type { CollectionConfig } from 'payload'

import { adminOnly } from '../../access/adminOnly'
import { adminOrContentEditor } from '../../access/adminOrContentEditor'
import { adminOrSelf } from '../../access/adminOrSelf'
// anyone import kept for future re-enablement of public signup
import { isUsersCollectionUser } from '@/server/payload/access/isUsersCollectionUser'
import { anyone } from '../../access/anyone'
import { auditRoleChange } from './hooks/auditRoleChange-hook'
import { createUserSettings } from './hooks/createUserSettings-hook'
import { ensureRoleOnSignup } from './hooks/ensureRoleOnSignup-hook'
import { preventLastAdminDemotion } from './hooks/preventLastAdminDemotion-hook'
import { optionalTenantField } from '../../fields/tenant'
import { ACCOUNT_ROLE_LABEL, AccountRole } from './roles'

export const Users: CollectionConfig = {
  slug: 'users',
  access: {
    admin: adminOrContentEditor, // Admins and Advanced Content Editors can access the admin panel
    create: anyone, // Anyone can create (signup). OAuth also uses overrideAccess.
    delete: adminOnly, // Only admins can delete users
    read: adminOrSelf, // Admins can read all, users can read their own
    update: adminOrSelf, // Admins can update all, users can update their own
  },
  admin: {
    defaultColumns: ['name', 'email', 'role'],
    useAsTitle: 'name',
  },
  auth: {
    cookies: {
      secure: true,
      sameSite: 'None',
    },
  },
  fields: [
    {
      name: 'name',
      type: 'text',
    },
    {
      name: 'role',
      type: 'select',
      options: Object.entries(ACCOUNT_ROLE_LABEL).map(([value, label]) => ({
        label,
        value,
      })),
      defaultValue: AccountRole.Student,
      required: true,
      saveToJWT: true, // Include in JWT for fast access checks
      access: {
        // Only admins can update the role field
        update: ({ req: { user } }) =>
          isUsersCollectionUser(user) && user.role === AccountRole.Admin,
      },
      hooks: {
        // Enforce role='student' on signup (ignore client input)
        beforeChange: [ensureRoleOnSignup],
      },
      admin: {
        position: 'sidebar',
      },
    },
    // Tenant
    optionalTenantField,
    // OAuth fields
    {
      name: 'googleSub',
      type: 'text',
      unique: true,
      index: true,
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'verifiedEmail',
      type: 'text',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'registrationMethod',
      type: 'select',
      options: [
        { label: 'Google', value: 'google' },
        { label: 'Email', value: 'email' },
      ],
      admin: {
        readOnly: true,
        position: 'sidebar',
      },
    },
    {
      name: 'registeredAt',
      type: 'date',
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'googleProfile',
      type: 'group',
      fields: [{ name: 'name', type: 'text' }],
      admin: {
        readOnly: true,
      },
    },
    {
      name: 'courseEntitlements',
      type: 'array',
      label: 'Course Entitlements',
      admin: {
        description: 'Courses this user has access to',
      },
      access: {
        update: ({ req: { user } }) =>
          isUsersCollectionUser(user) && user.role === AccountRole.Admin,
      },
      fields: [
        {
          name: 'course',
          type: 'relationship',
          relationTo: 'courses',
          required: true,
          admin: { readOnly: true },
        },
        {
          name: 'grantMethod',
          type: 'select',
          required: true,
          defaultValue: 'admin',
          options: [
            { label: 'Admin Grant', value: 'admin' },
            { label: 'Payment', value: 'payment' },
            { label: 'Access Code', value: 'code' },
          ],
          admin: { readOnly: true },
        },
        {
          name: 'grantedAt',
          type: 'date',
          defaultValue: () => new Date().toISOString(),
          admin: { readOnly: true },
        },
        {
          name: 'transactionId',
          type: 'text',
          admin: { readOnly: true },
        },
      ],
    },
    {
      name: 'featureEntitlements',
      type: 'array',
      label: 'Feature Entitlements',
      admin: {
        description: 'Standalone feature access granted via payment',
      },
      access: {
        update: ({ req: { user } }) =>
          isUsersCollectionUser(user) && user.role === AccountRole.Admin,
      },
      fields: [
        {
          name: 'key',
          type: 'text',
          required: true,
          admin: { readOnly: true },
        },
        // value/period/expiresAt are populated by Task B/C grants and may be
        // absent on pre-refactor rows. Defensive reads live in
        // resolveFeatureEntitlement (feature-quota.ts) — keep the typeof
        // guards there even when the schema looks complete.
        {
          name: 'value',
          type: 'number',
          admin: { readOnly: true },
        },
        {
          name: 'period',
          type: 'select',
          options: [
            { label: 'Day', value: 'day' },
            { label: 'Month', value: 'month' },
            { label: 'Lifetime', value: 'lifetime' },
          ],
          admin: { readOnly: true },
        },
        {
          name: 'transactionId',
          type: 'text',
          admin: { readOnly: true },
        },
        {
          name: 'grantedAt',
          type: 'date',
          defaultValue: () => new Date().toISOString(),
          admin: { readOnly: true },
        },
        {
          name: 'expiresAt',
          type: 'date',
          admin: {
            readOnly: true,
            description:
              'When this feature entitlement expires. Mirrors the parent Enrollment expiry when the source product has durationDays; null = lifetime.',
          },
        },
      ],
    },
    // Chat quota fields (rolling window — legacy fallback for users without
    // an `ai-questions` feature entitlement; see feature-quota.ts for the
    // entitlement-driven per-day path).
    {
      name: 'chatQuestionsUsed',
      type: 'number',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        description: 'Questions used in current window',
      },
    },
    {
      name: 'chatWindowStart',
      type: 'date',
      admin: {
        position: 'sidebar',
        description: 'When the current chat quota window started',
      },
    },
    // LLM token accounting (month-boundary reset). Written by A-Guy-Web via
    // the raw MongoDB driver ($inc). Declared here so Payload's full-doc save
    // on admin edits does not wipe the counters.
    {
      name: 'llmTokensUsed',
      type: 'number',
      defaultValue: 0,
      // Server-only: written by A-Guy-Web via raw MongoDB $inc. Blocking REST/
      // GraphQL create+update prevents signup POSTs from seeding a negative
      // starting balance and PATCHes from resetting the counter.
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        readOnly: true,
        description: 'LLM tokens consumed in the current reset window',
      },
    },
    {
      name: 'llmTokensLimit',
      type: 'number',
      // Admin-only for both create and update: managers set per-user caps.
      // Without the create guard, `create: anyone` at the collection level
      // would let a signup POST inject an unbounded limit.
      access: {
        create: ({ req: { user } }) =>
          isUsersCollectionUser(user) && user.role === AccountRole.Admin,
        update: ({ req: { user } }) =>
          isUsersCollectionUser(user) && user.role === AccountRole.Admin,
      },
      admin: {
        description: 'Per-window token cap. Null / undefined = no limit.',
      },
    },
    {
      name: 'llmTokensResetAt',
      type: 'date',
      // Server-only: rolled forward by Web on first increment of a new month.
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        readOnly: true,
        description:
          'When llmTokensUsed rolls back to 0. Web sets this to first-of-next-month on first increment of a new month.',
      },
    },
    // Feature-quota counters (Asia/Jerusalem calendar day). One bucket pair
    // per enforceable feature key. Bucket strings are YYYY-MM-DD in IL time;
    // counter resets when the bucket changes.
    {
      name: 'aiQuestionsUsedDay',
      type: 'number',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        description: 'AI questions used in the current Asia/Jerusalem day',
        readOnly: true,
      },
    },
    {
      name: 'aiQuestionsBucketDay',
      type: 'text',
      admin: {
        position: 'sidebar',
        description: 'YYYY-MM-DD bucket (Asia/Jerusalem) for aiQuestionsUsedDay',
        readOnly: true,
      },
    },
    {
      name: 'chatLimitUsedDay',
      type: 'number',
      defaultValue: 0,
      admin: {
        position: 'sidebar',
        description: 'Chat messages used in the current Asia/Jerusalem day (silent cap)',
        readOnly: true,
      },
    },
    {
      name: 'chatLimitBucketDay',
      type: 'text',
      admin: {
        position: 'sidebar',
        description: 'YYYY-MM-DD bucket (Asia/Jerusalem) for chatLimitUsedDay',
        readOnly: true,
      },
    },
    // Current course the user is working on. Single value (users can only be
     // on one course at a time). Written server-side by the Web app via
     // PATCH /api/users/me/course-state on login and lesson open. Blocked from
     // client-side create/update so the admin-panel and unauthenticated signup
     // POSTs can't reset it.
    {
      name: 'currentCourse',
      type: 'relationship',
      relationTo: 'courses',
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        readOnly: true,
        description:
          'Course the user is currently on. Written by Web via /api/users/me/course-state.',
      },
    },
    // Last time the user was seen active. Written server-side by the Web app
     // via PATCH /api/users/me/course-state (on login and lesson open).
    {
      name: 'lastLoginAt',
      type: 'date',
      access: {
        create: () => false,
        update: () => false,
      },
      admin: {
        readOnly: true,
        description: 'Last time the user logged in or opened a lesson.',
      },
    },
    {
      name: 'oauthLoginSecretEnc',
      type: 'text',
      // Encrypted secret for payload.login() - required for OAuth users
      // Server-side reads allowed via overrideAccess in callback
      access: {
        read: () => false, // Never exposed to client
        create: () => true, // Set during OAuth user creation
        update: () => false, // Never updatable after creation
      },
      admin: {
        hidden: true,
      },
    },
  ],
  hooks: {
    // Prevent demoting the last admin
    beforeChange: [preventLastAdminDemotion],
    // Audit trail for role changes
    afterChange: [auditRoleChange, createUserSettings],
  },
  timestamps: true,
}
