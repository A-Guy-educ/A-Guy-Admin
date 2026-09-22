/**
 * Thin Gemini wrapper for structured-JSON stages. Uses `responseMimeType`
 * and `responseSchema` so the model is forced into a Zod-validated shape,
 * matching the pattern in
 * src/server/services/lesson-context-conversion/structured-extraction.ts.
 *
 * MVP-scoped: no circuit breaker / retry / timeout wrapper — one call at a
 * time, from a batch CLI. If we later move this into the app runtime the
 * main-repo helpers should wrap this.
 */
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai'
import { z } from 'zod'

const DEFAULT_MODEL = 'gemini-2.5-flash'

interface GenerateJsonInput<TSchema extends z.ZodTypeAny> {
  systemInstruction: string
  userPrompt: string
  schema: TSchema
  modelName?: string
  temperature?: number
  maxOutputTokens?: number
}

/**
 * Convert a Zod schema into the OpenAPI-3.0 subset that Gemini's
 * responseSchema accepts. Strips $schema/additionalProperties/definitions
 * and rewrites `type` → SchemaType enum values.
 */
function zodToGeminiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>
  return normalize(json) as Record<string, unknown>
}

// Keys that Gemini's constraint solver chokes on. Zod still enforces them
// at runtime (see the safeParse call), so stripping here is lossless —
// Gemini only needs the shape (types + properties + required + enum).
const STRIP_KEYS = new Set([
  '$schema',
  'additionalProperties',
  '$defs',
  'definitions',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'pattern',
  'format',
])

function normalize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(normalize)
  if (!node || typeof node !== 'object') return node
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (STRIP_KEYS.has(k)) continue
    if (k === 'type' && typeof v === 'string') {
      out[k] = mapType(v)
      continue
    }
    out[k] = normalize(v)
  }
  return out
}

function mapType(t: string): SchemaType {
  switch (t) {
    case 'string':
      return SchemaType.STRING
    case 'number':
      return SchemaType.NUMBER
    case 'integer':
      return SchemaType.INTEGER
    case 'boolean':
      return SchemaType.BOOLEAN
    case 'array':
      return SchemaType.ARRAY
    case 'object':
      return SchemaType.OBJECT
    default:
      return SchemaType.STRING
  }
}

export async function generateJson<TSchema extends z.ZodTypeAny>(
  input: GenerateJsonInput<TSchema>,
): Promise<z.infer<TSchema>> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set. Add it to .env (it is already used elsewhere in the repo).',
    )
  }

  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({
    model: input.modelName ?? DEFAULT_MODEL,
    systemInstruction: input.systemInstruction,
    generationConfig: {
      temperature: input.temperature ?? 0.2,
      maxOutputTokens: input.maxOutputTokens ?? 16384,
      responseMimeType: 'application/json',
      responseSchema: zodToGeminiSchema(input.schema) as never,
    },
  })

  const result = await model.generateContent(input.userPrompt)
  const text = result.response.text()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(
      `Gemini returned non-JSON output: ${text.slice(0, 200)}… (${(err as Error).message})`,
    )
  }

  const validation = input.schema.safeParse(parsed)
  if (!validation.success) {
    throw new Error(
      `Gemini output failed schema validation: ${JSON.stringify(validation.error.issues, null, 2)}\nRaw: ${text.slice(0, 500)}`,
    )
  }
  return validation.data
}
