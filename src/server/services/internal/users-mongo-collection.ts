/**
 * Shared helper to extract the raw mongo Users collection from Payload's
 * db adapter. Used by feature-quota and chat-quota for atomic counter ops
 * that can't go through the Local API.
 *
 * @fileType utility
 * @domain internal
 */

import type { Collection, Document } from 'mongodb'
import type { Payload } from 'payload'

export function getUsersMongoCollection(payload: Payload): Collection<Document> | null {
  const db = payload.db as unknown as {
    connection?: { collection?: (name: string) => unknown }
    collections?: Record<string, unknown>
    collection?: (name: string) => unknown
  }
  const collection =
    db.connection?.collection?.('users') ||
    db.collections?.['users'] ||
    (db.collections as Record<string, unknown>)?.users ||
    db.collection?.('users') ||
    null
  return (collection as Collection<Document>) ?? null
}
