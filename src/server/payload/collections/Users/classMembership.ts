/**
 * Class-membership lookups backing the Users B2B/B2C segment.
 *
 * @fileType repository
 * @domain classroom
 * @ai-summary Batched classes/schools queries resolving user → school names
 */

import type { PayloadRequest } from 'payload'

type RelationValue = string | { id?: unknown } | null | undefined

interface ClassMembershipDoc {
  school?: RelationValue
  students?: RelationValue[] | null
  teachers?: RelationValue[] | null
}

const toId = (value: RelationValue): string | null => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && value.id != null) return String(value.id)
  return null
}

const membersOf = (cls: ClassMembershipDoc): string[] =>
  [...(cls.students ?? []), ...(cls.teachers ?? [])]
    .map(toId)
    .filter((id): id is string => id !== null)

const findClasses = async (req: PayloadRequest, userIds?: string[]) => {
  const result = await req.payload.find({
    collection: 'classes',
    where: userIds
      ? { or: [{ students: { in: userIds } }, { teachers: { in: userIds } }] }
      : undefined,
    select: { school: true, students: true, teachers: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return result.docs as ClassMembershipDoc[]
}

const findSchoolNames = async (
  req: PayloadRequest,
  schoolIds: string[],
): Promise<Map<string, string>> => {
  if (schoolIds.length === 0) return new Map()
  const result = await req.payload.find({
    collection: 'schools',
    where: { id: { in: schoolIds } },
    select: { name: true },
    depth: 0,
    pagination: false,
    overrideAccess: true,
    req,
  })
  return new Map(result.docs.map((school) => [String(school.id), school.name]))
}

/**
 * Resolves class membership for a set of users with one `classes` query and
 * one `schools` query. Users absent from the returned map are in no class.
 * Each member maps to its distinct school names (empty if a school was deleted).
 */
export const resolveClassMembership = async (
  req: PayloadRequest,
  userIds: string[],
): Promise<Map<string, string[]>> => {
  if (userIds.length === 0) return new Map()

  const wanted = new Set(userIds)
  const classes = await findClasses(req, userIds)

  const schoolIdsByUser = new Map<string, Set<string>>()
  for (const cls of classes) {
    const schoolId = toId(cls.school)
    for (const memberId of membersOf(cls)) {
      if (!wanted.has(memberId)) continue
      const schoolIds = schoolIdsByUser.get(memberId) ?? new Set<string>()
      if (schoolId) schoolIds.add(schoolId)
      schoolIdsByUser.set(memberId, schoolIds)
    }
  }

  const allSchoolIds = [...new Set([...schoolIdsByUser.values()].flatMap((ids) => [...ids]))]
  const schoolNames = await findSchoolNames(req, allSchoolIds)

  return new Map(
    [...schoolIdsByUser].map(([userId, schoolIds]) => [
      userId,
      [...schoolIds].map((id) => schoolNames.get(id)).filter((name): name is string => !!name),
    ]),
  )
}

/** Every user id that appears in any class as a student or teacher. */
export const findAllClassMemberIds = async (req: PayloadRequest): Promise<string[]> => {
  const classes = await findClasses(req)
  return [...new Set(classes.flatMap(membersOf))]
}
