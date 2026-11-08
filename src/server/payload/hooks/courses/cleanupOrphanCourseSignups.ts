import type { CollectionAfterDeleteHook } from 'payload'

/**
 * After a course is deleted, remove its sign-ups so students aren't left
 * signed up for a course that no longer exists.
 */
export const cleanupOrphanCourseSignups: CollectionAfterDeleteHook = async ({ id, req }) => {
  if (!id) return

  await req.payload.delete({
    collection: 'course-signups',
    where: { course: { equals: id } },
    overrideAccess: true,
    req,
  })
}
