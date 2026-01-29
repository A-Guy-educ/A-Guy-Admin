import type { Migration } from 'payload'

export const backfillExerciseOrigin: Migration = {
  name: 'backfill-exercise-origin',
  async up(db: any) {
    // Backfill origin='manual' for existing exercises that don't have origin set
    const result = await db.collection('exercises').updateMany(
      {
        $or: [{ origin: { $exists: false } }, { origin: null }, { origin: '' }],
      },
      {
        $set: { origin: 'manual' },
      },
    )

    console.log(`Backfilled origin field for ${result.modifiedCount} exercises`)
  },

  async down(_db: any) {
    // No-op: We don't want to remove origin values on rollback
    console.log('Rollback: origin field backfill skipped (preserving data)')
  },
}
