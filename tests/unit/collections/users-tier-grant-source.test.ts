/**
 * `tierGrantSource` values are a cross-repo contract: A-Guy-Web writes 'b2b'
 * on /join sign-in via the raw driver, and the boot backfill must not retag it.
 */
import { describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

import { Users } from '@/server/payload/collections/Users'
import { backfillTierGrantSource } from '@/server/payload/migrations/backfillTierGrantSource'

const findField = (name: string) =>
  Users.fields.find((f) => 'name' in f && f.name === name) as
    | { options?: { value: string }[] }
    | undefined

describe('Users tierGrantSource', () => {
  it('accepts the values Admin and Web write', () => {
    expect(findField('tierGrantSource')?.options?.map((o) => o.value)).toEqual([
      'subscription',
      'legacy_one_time',
      'manual',
      'b2b',
    ])
  })

  it('backfill only tags users without a grant source, so b2b grants are kept', async () => {
    const updateMany = vi.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 })
    const payload = {
      db: { connection: { db: { collection: () => ({ updateMany }) } } },
      logger: { info: vi.fn(), warn: vi.fn() },
    } as unknown as Payload

    await backfillTierGrantSource(payload)

    const [filter] = updateMany.mock.calls[0]
    expect(filter.$or).toEqual([{ tierGrantSource: { $exists: false } }, { tierGrantSource: null }])
  })
})
