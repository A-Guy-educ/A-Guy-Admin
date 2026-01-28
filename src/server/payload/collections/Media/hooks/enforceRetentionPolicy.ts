/**
 * beforeChange hook to enforce server-only retention policy
 *
 * THIS HOOK IS AUTHORITATIVE - access rules alone are insufficient because
 * the fields exist in every document and are required.
 *
 * Behavior:
 * - Clients (no allowRetentionPatch): always force persistent, strip expiresAt
 * - Server (allowRetentionPatch=true): allow ephemeral + expiresAt
 */
import type { CollectionBeforeChangeHook } from 'payload'

export const enforceRetentionPolicyHook: CollectionBeforeChangeHook = async ({
  data,
  req,
  operation,
  originalDoc,
}) => {
  const isServerPatch = req?.context?.allowRetentionPatch === true

  if (operation === 'create') {
    if (isServerPatch) {
      // Server patch: allow ephemeral + expiresAt (must validate below)
      if (data.retentionPolicy === 'ephemeral' && !data.expiresAt) {
        throw new Error('Ephemeral media must have expiresAt set')
      }
      return data
    }
    // Client upload: always force persistent defaults
    return {
      ...data,
      retentionPolicy: 'persistent',
      expiresAt: null,
    }
  }

  if (operation === 'update') {
    if (isServerPatch) {
      // Server patch: allow ephemeral + expiresAt
      if (data.retentionPolicy === 'ephemeral' && !data.expiresAt) {
        throw new Error('Ephemeral media must have expiresAt set')
      }
      return data
    }
    // Client update: preserve original values (ignore incoming)
    return {
      ...data,
      retentionPolicy: originalDoc?.retentionPolicy || 'persistent',
      expiresAt: originalDoc?.expiresAt || null,
    }
  }

  return data
}
