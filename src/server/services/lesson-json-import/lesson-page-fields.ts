import { z } from 'zod'

const blankToUndefined = (value: unknown) =>
  value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value

const optionalText = z.string().nullish()

/**
 * Optional top-level keys in a lesson JSON that fill the public lesson page.
 * Each maps 1:1 onto a lesson field; a key that is missing, null or blank is
 * left out so the lesson keeps whatever Admin already has.
 */
export const LessonPageJsonSchema = z.object({
  lesson_objective: optionalText,
  intro: optionalText,
  description: optionalText,
  public_explanation: optionalText,
  formulas: optionalText,
  examples: optionalText,
  common_mistakes: optionalText,
  estimated_minutes: z.preprocess(blankToUndefined, z.coerce.number().int().positive().optional()),
  keywords: z.union([z.string(), z.array(z.string())]).nullish(),
  seo_title: optionalText,
  meta_description: optionalText,
})

export type LessonPageJson = z.infer<typeof LessonPageJsonSchema>

const TEXT_FIELDS = {
  lesson_objective: 'lessonObjective',
  intro: 'intro',
  description: 'description',
  public_explanation: 'publicExplanation',
  formulas: 'formulas',
  examples: 'examples',
  common_mistakes: 'commonMistakes',
} as const satisfies Partial<Record<keyof LessonPageJson, string>>

type TextField = (typeof TEXT_FIELDS)[keyof typeof TEXT_FIELDS]

export type LessonPageFields = Partial<Record<TextField, string>> & {
  estimatedMinutes?: number
  meta?: { title?: string; description?: string; keywords?: string }
}

const clean = (value: string | null | undefined) => value?.trim() || undefined

/** Drops entries whose value is undefined, so blank keys never reach the lesson. */
const compact = <T extends object>(record: T): Partial<T> =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined),
  ) as Partial<T>

function keywordsText(keywords: LessonPageJson['keywords']): string | undefined {
  const list = Array.isArray(keywords) ? keywords : (keywords ?? '').split(',')
  return clean(
    list
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .join(', '),
  )
}

export function lessonPageFieldsFromJson(json: LessonPageJson): LessonPageFields {
  const textFields = Object.fromEntries(
    Object.entries(TEXT_FIELDS).map(([jsonKey, field]) => [
      field,
      clean(json[jsonKey as keyof typeof TEXT_FIELDS]),
    ]),
  )
  const meta = compact({
    title: clean(json.seo_title),
    description: clean(json.meta_description),
    keywords: keywordsText(json.keywords),
  })

  return compact({
    ...textFields,
    estimatedMinutes: json.estimated_minutes,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  })
}
