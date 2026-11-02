/**
 * Users B2B/B2C segment against real Payload + Mongo: the virtual fields are
 * filled on admin reads, never persisted, and the ?segment= base list filter
 * translates into a working id constraint.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ObjectId, type Collection } from 'mongodb'
import type { Payload, PayloadRequest } from 'payload'

import { getSharedPayload } from '../setup/shared-payload'
import { userSegmentListFilter } from '@/server/payload/collections/Users/userSegmentListFilter'

describe('Users segment (B2B / B2C)', () => {
  let payload: Payload
  let admin: { id: string; role: string; collection: 'users' }
  const userIds: string[] = []
  const schoolIds = [new ObjectId(), new ObjectId()]
  const classIds = [new ObjectId(), new ObjectId()]
  let studentId: string
  let mixedId: string
  let lonerId: string

  const rawCollection = (slug: 'classes' | 'schools' | 'users') =>
    (payload.db as unknown as { collections: Record<string, { collection: Collection }> })
      .collections[slug].collection

  const createUser = async (label: string) => {
    const user = (await payload.create({
      collection: 'users',
      data: {
        email: `segment-${label}-${Date.now()}@example.com`,
        password: 'pw-123456',
        name: label,
        role: label === 'admin' ? 'admin' : 'student',
      },
      overrideAccess: true,
    })) as { id: string }
    userIds.push(user.id)
    return user.id
  }

  beforeAll(async () => {
    payload = await getSharedPayload()
    admin = { id: await createUser('admin'), role: 'admin', collection: 'users' }
    studentId = await createUser('student')
    mixedId = await createUser('mixed')
    lonerId = await createUser('loner')

    // Raw inserts: Classes require a course/tenant we don't need for this check.
    await rawCollection('schools').insertMany([
      { _id: schoolIds[0], name: 'Segment School A' },
      { _id: schoolIds[1], name: 'Segment School B' },
    ])
    await rawCollection('classes').insertMany([
      {
        _id: classIds[0],
        name: 'A1',
        school: schoolIds[0],
        students: [new ObjectId(studentId)],
        teachers: [new ObjectId(mixedId)],
      },
      {
        _id: classIds[1],
        name: 'B1',
        school: schoolIds[1],
        students: [new ObjectId(mixedId)],
        teachers: [],
      },
    ])
  })

  afterAll(async () => {
    await rawCollection('classes').deleteMany({ _id: { $in: classIds } })
    await rawCollection('schools').deleteMany({ _id: { $in: schoolIds } })
    for (const id of userIds) {
      await payload.delete({ collection: 'users', id, overrideAccess: true }).catch(() => {})
    }
  })

  it('derives segment and schools on admin reads', async () => {
    const { docs } = await payload.find({
      collection: 'users',
      where: { id: { in: [studentId, mixedId, lonerId] } },
      user: admin,
      overrideAccess: false,
    })
    const byId = new Map(docs.map((d) => [d.id, d]))

    expect(byId.get(studentId)).toMatchObject({ segment: 'b2b', schools: ['Segment School A'] })
    expect([...(byId.get(mixedId)?.schools ?? [])].sort()).toEqual([
      'Segment School A',
      'Segment School B',
    ])
    expect(byId.get(lonerId)).toMatchObject({ segment: 'b2c', schools: [] })
  })

  it('does not persist the virtual fields', async () => {
    await payload.update({
      collection: 'users',
      id: studentId,
      data: { name: 'student-renamed' },
      user: admin,
      overrideAccess: false,
    })
    const raw = await rawCollection('users').findOne({ _id: new ObjectId(studentId) })
    expect(raw).not.toHaveProperty('segment')
    expect(raw).not.toHaveProperty('schools')
  })

  it('filters the list by segment', async () => {
    const filterFor = async (segment: string) => {
      const where = await userSegmentListFilter({
        req: { payload, user: admin, query: { segment }, context: {} } as unknown as PayloadRequest,
        limit: 10,
        page: 1,
        sort: 'id',
      })
      const { docs } = await payload.find({
        collection: 'users',
        where: { and: [{ id: { in: [studentId, mixedId, lonerId] } }, where ?? {}] },
        overrideAccess: true,
        depth: 0,
      })
      return docs.map((d) => d.id).sort()
    }

    expect(await filterFor('b2b')).toEqual([studentId, mixedId].sort())
    expect(await filterFor('b2c')).toEqual([lonerId])
  })
})
