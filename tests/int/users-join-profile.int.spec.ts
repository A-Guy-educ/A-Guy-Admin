/**
 * Users join-profile fields against real Payload + Mongo: Web's raw-driver
 * writes are readable by admins, phone (PII) is stripped for other users, and
 * onboardingType can't be set through access-checked writes.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId, type Collection } from 'mongodb'
import type { Payload } from 'payload'

import { getSharedPayload } from '../setup/shared-payload'

type TestUser = { id: string; role: string; collection: 'users' }

describe('Users join-profile fields', () => {
  let payload: Payload
  let admin: TestUser
  let joiner: TestUser
  let otherStudent: TestUser
  const userIds: string[] = []

  const usersRaw = () =>
    (payload.db as unknown as { collections: Record<string, { collection: Collection }> })
      .collections.users.collection

  const createUser = async (label: string, role: 'admin' | 'student'): Promise<TestUser> => {
    const user = (await payload.create({
      collection: 'users',
      data: {
        email: `join-${label}-${Date.now()}@example.com`,
        password: 'pw-123456',
        name: label,
        role,
      },
      overrideAccess: true,
    })) as { id: string }
    userIds.push(user.id)
    return { id: user.id, role, collection: 'users' }
  }

  beforeAll(async () => {
    payload = await getSharedPayload()
    admin = await createUser('admin', 'admin')
    joiner = await createUser('joiner', 'student')
    otherStudent = await createUser('other', 'student')

    // Mirror Web's /join write: raw driver, not Payload.
    await usersRaw().updateOne(
      { _id: new ObjectId(joiner.id) },
      {
        $set: {
          firstName: 'Dana',
          lastName: 'Levi',
          phone: '0501234567',
          name: 'Dana Levi',
          onboardingType: 'b2b',
        },
      },
    )
  })

  afterAll(async () => {
    for (const id of userIds) {
      await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
    }
  })

  const readAs = (user: TestUser, id: string) =>
    payload.findByID({ collection: 'users', id, user, overrideAccess: false, depth: 0 })

  it('returns all join-profile fields to admins', async () => {
    const doc = await readAs(admin, joiner.id)
    expect(doc).toMatchObject({
      firstName: 'Dana',
      lastName: 'Levi',
      phone: '0501234567',
      onboardingType: 'b2b',
    })
  })

  it('returns the phone to the user themselves', async () => {
    const doc = await readAs(joiner, joiner.id)
    expect(doc.phone).toBe('0501234567')
  })

  it('does not let another student read the user at all', async () => {
    await expect(readAs(otherStudent, joiner.id)).rejects.toThrow()
  })

  it('ignores self-updates to onboardingType and phone', async () => {
    await payload.update({
      collection: 'users',
      id: joiner.id,
      data: { onboardingType: 'b2c', phone: '0549999999' },
      user: joiner,
      overrideAccess: false,
    })
    const raw = await usersRaw().findOne({ _id: new ObjectId(joiner.id) })
    expect(raw?.onboardingType).toBe('b2b')
    expect(raw?.phone).toBe('0501234567')
  })

  it('keeps Web-written fields when an admin saves the user', async () => {
    await payload.update({
      collection: 'users',
      id: joiner.id,
      data: { lastName: 'Cohen' },
      user: admin,
      overrideAccess: false,
    })
    const raw = await usersRaw().findOne({ _id: new ObjectId(joiner.id) })
    expect(raw).toMatchObject({ lastName: 'Cohen', phone: '0501234567', onboardingType: 'b2b' })
  })
})
