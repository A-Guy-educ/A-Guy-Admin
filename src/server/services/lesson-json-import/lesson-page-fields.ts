import { z } from 'zod'

/**
 * Optional top-level keys in a lesson JSON that fill the public lesson page.
 * Each maps 1:1 onto a lesson field; a key that is missing or blank is left
 * out so the lesson keeps whatever Admin already has.
 */
export const LessonPageJsonSchema = z.object({
  lesson_objective: z.string().optional(),
  intro: z.string().optional(),
  description: z.string().optional(),
  public_explanation: z.string().optional(),
  formulas: z.string().optional(),
  examples: z.string().optional(),
  common_mistakes: z.string().optional(),
  estimated_minutes: z.coerce.number().int().positive().optional(),
  keywords: z.union([z.string(), z.array(z.string())]).optional(),
  seo_title: z.string().optional(),
  meta_description: z.string().optional(),
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

export interface LessonPageFields {
  lessonObjective?: string
  intro?: string
  description?: string
  publicExplanation?: string
  formulas?: string
  examples?: string
  commonMistakes?: string
  estimatedMinutes?: number
  meta?: { title?: string; description?: string; keywords?: string }
}

const clean = (value: string | undefined) => value?.trim() || undefined

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
  const fields: LessonPageFields = {}
  for (const [jsonKey, field] of Object.entries(TEXT_FIELDS)) {
    const value = clean(json[jsonKey as keyof typeof TEXT_FIELDS])
    if (value) fields[field] = value
  }
  if (json.estimated_minutes) fields.estimatedMinutes = json.estimated_minutes

  const meta = {
    title: clean(json.seo_title),
    description: clean(json.meta_description),
    keywords: keywordsText(json.keywords),
  }
  const metaEntries = Object.entries(meta).filter(([, value]) => value)
  if (metaEntries.length > 0) fields.meta = Object.fromEntries(metaEntries)

  return fields
}
