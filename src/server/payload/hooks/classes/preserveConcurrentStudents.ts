import type { CollectionBeforeChangeHook, Field, FieldHook } from 'payload'

/**
 * A-Guy-Web's /join page $push-es students onto `classes.students` directly in
 * Mongo. An Admin save writes back the whole array the form loaded, so a student
 * who joined while the class was open in the editor would be silently dropped.
 *
 * The form carries a hidden snapshot of the student ids it loaded. On save, any
 * id stored now but missing from that snapshot was added after load — the editor
 * never saw it, so it can't have been removed on purpose — and is kept.
 */

export const LOADED_STUDENTS_FIELD = 'loadedStudents'

type MaybePopulated = string | { id: string } | null | undefined

const toIds = (value: unknown): string[] =>
  Array.isArray(value)
    ? (value as MaybePopulated[])
        .map((v) => (v && typeof v === 'object' ? v.id : v))
        .filter((v): v is string => typeof v === 'string')
    : []

const snapshotStudents: FieldHook = ({ siblingData }) => toIds(siblingData?.students)

/** Virtual (never stored), hidden field holding the student ids the form loaded. */
export const loadedStudentsField: Field = {
  name: LOADED_STUDENTS_FIELD,
  type: 'json',
  virtual: true,
  admin: { hidden: true },
  hooks: { afterRead: [snapshotStudents] },
}

export const preserveConcurrentStudents: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
}) => {
  const { [LOADED_STUDENTS_FIELD]: loaded, ...rest } = data
  // Only form saves carry the snapshot; other writers keep plain overwrite semantics.
  if (operation !== 'update' || !Array.isArray(loaded) || !Array.isArray(rest.students)) {
    return rest
  }

  const loadedIds = new Set(toIds(loaded))
  const submittedIds = new Set(toIds(rest.students))
  const joinedSinceLoad = toIds(originalDoc?.students).filter(
    (id) => !loadedIds.has(id) && !submittedIds.has(id),
  )

  return joinedSinceLoad.length === 0
    ? rest
    : { ...rest, students: [...rest.students, ...joinedSinceLoad] }
}
