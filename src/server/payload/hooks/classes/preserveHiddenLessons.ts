import type { CollectionBeforeChangeHook } from 'payload'

/**
 * A-Guy-Web writes `classes.hiddenLessons` directly in Mongo ($addToSet / $pull)
 * when a teacher hides lessons in the teacher app. An Admin save writes back
 * whatever the form loaded, which would revert a teacher's change made while the
 * class was open in the editor.
 *
 * Admin never edits this field, so the stored value always wins: no loaded
 * snapshot is needed. A new class starts with nothing hidden.
 */

export const HIDDEN_LESSONS_FIELD = 'hiddenLessons'

export const preserveHiddenLessons: CollectionBeforeChangeHook = ({
  data,
  operation,
  originalDoc,
}) => {
  const { [HIDDEN_LESSONS_FIELD]: _submitted, ...rest } = data
  const stored = operation === 'update' ? originalDoc?.[HIDDEN_LESSONS_FIELD] : undefined

  return stored == null ? rest : { ...rest, [HIDDEN_LESSONS_FIELD]: stored }
}
