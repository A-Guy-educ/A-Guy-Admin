/**
 * Migration: Localize Teacher Profiles
 *
 * Backfills dual-language fields (label_en, label_he, description_en, description_he)
 * for all existing teacher profile documents.
 *
 * Idempotent — skips profiles that already have label_en populated.
 *
 * @fileType migration
 * @domain ai
 * @pattern migration
 * @ai-summary One-time migration to add localized label/description fields to teacher profiles
 */

import type { Payload } from 'payload'

/**
 * Known Hebrew translations keyed by slug.
 * Profiles not in this map will have label_he default to label_en.
 */
const HEBREW_TRANSLATIONS: Record<string, { label_he: string; description_he: string }> = {
  teacher_strict: {
    label_he: 'מורה קפדן',
    description_he: 'שומר על סטנדרטים גבוהים ומצפה לתשובות מדויקות.',
  },
  teacher_thorough: {
    label_he: 'מורה יסודי',
    description_he: 'מספק הסברים מקיפים עם פרוט נרחב.',
  },
  teacher_patient: {
    label_he: 'מורה סבלני',
    description_he: 'ניגש ללמידה עם סבלנות ועידוד.',
  },
  teacher_focused: {
    label_he: 'מורה ממוקד',
    description_he: 'שומר על השיעורים ממוקדים עם יעדים ברורים.',
  },
  teacher_challenging: {
    label_he: 'מורה מאתגר',
    description_he: 'מאתגר תלמידים עם שאלות מעוררות מחשבה וחומר מתקדם.',
  },
}

export async function localizeTeacherProfiles(
  payload: Payload,
): Promise<{ updated: number; skipped: number; errors: number }> {
  let updated = 0
  let skipped = 0
  let errors = 0

  const result = await payload.find({
    collection: 'teacher_profiles',
    limit: 0, // fetch count first
    overrideAccess: true,
  })

  const allProfiles = await payload.find({
    collection: 'teacher_profiles',
    limit: result.totalDocs || 100,
    overrideAccess: true,
  })

  for (const profile of allProfiles.docs) {
    // Skip if already migrated (label_en already set)
    if (profile.label_en) {
      skipped++
      continue
    }

    try {
      const slug = profile.slug as string
      const hebrew = HEBREW_TRANSLATIONS[slug]

      // Cast to access legacy fields that existed before schema change
      const legacy = profile as unknown as { label?: string; description?: string }

      await payload.update({
        collection: 'teacher_profiles',
        id: profile.id,
        data: {
          label_en: legacy.label ?? slug,
          label_he: hebrew?.label_he ?? legacy.label ?? slug,
          description_en: legacy.description ?? '',
          description_he: hebrew?.description_he ?? legacy.description ?? '',
        },
        overrideAccess: true,
      })

      updated++
    } catch {
      payload.logger?.warn(`[localizeTeacherProfiles] Failed to migrate profile ${profile.id}`)
      errors++
    }
  }

  return { updated, skipped, errors }
}

/**
 * onInit wrapper — runs automatically on server startup, idempotent.
 */
export async function runLocalizeTeacherProfilesOnInit(payload: Payload): Promise<void> {
  const { updated, skipped, errors } = await localizeTeacherProfiles(payload)

  if (updated > 0 || errors > 0) {
    payload.logger?.info(
      `[localizeTeacherProfiles] Migrated ${updated} profiles (${skipped} already done, ${errors} errors)`,
    )
  }
}
