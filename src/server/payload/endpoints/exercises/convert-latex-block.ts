/**
 * POST /api/exercises/convert-latex-block
 *
 * In-place conversion: if an exercise has one or more `{type:'latex'}` blocks,
 * parse each block's LaTeX via the deterministic script parser and insert the
 * parsed structured blocks immediately after the original LaTeX block — same
 * exercise, same unit, content fleshed out. The original LaTeX block is kept
 * as a source-of-truth reference; the exercise viewer hides it from students.
 *
 * With the new Sections collection between exercise and question, the parsed
 * stream is partitioned post-parse: shared intro blocks stay on
 * `exercise.content.blocks`, and one section is created per question block
 * with the question always as its LAST block. Trailing non-question blocks
 * attach to the LAST section. The sectionRef playlist is written to
 * `exercise.blocks` in a single follow-up update.
 *
 * Both the single-exercise endpoint and the lesson-level pipeline's Stage 3
 * inherit this behaviour via this endpoint change — there is no duplicated
 * partition logic in `lesson-context-conversion/full-pipeline.ts`.
 *
 * Fallback (V1-259): when the script parser produces zero usable blocks for a
 * LaTeX block AND fallback is enabled, the AI import route is called internally.
 * The AI route creates temp exercises; we harvest their blocks, apply them to
 * this exercise, then delete the temps.
 *
 * Access: Authenticated users only.
 */
import type { PayloadRequest } from 'payload'
import { parseLatexToBlocks } from '@/lib/latex-parser'
import { logger } from '@/infra/utils/logger'
import { getConfigValueByKey } from '@/infra/config/runtime'
import { ConfigDomain } from '@/infra/config/config-constants'
import type { Section as SectionDoc } from '@/payload-types'
import type {
  ContentBlock,
  ContentData,
  LatexBlock,
} from '@/server/payload/collections/Exercises/types'
import { emptyPlaceholder, partitionBlocks } from '@/server/services/sections/partition-blocks'

type ImportMethod = 'script' | 'ai_fallback'

interface ConversionOutcome {
  /** IDs of LaTeX blocks that were successfully parsed. The blocks themselves
   *  remain in content (the viewer hides them); the parsed structured blocks
   *  are inserted immediately after each. */
  convertedBlockIds: string[]
  addedBlockCount: number
  method: ImportMethod
  warnings: { line: number; message: string; rawLatex: string }[]
  errors: { line: number; message: string; rawLatex: string }[]
}

interface BlockEntry {
  id: string
  blockType: 'sectionRef'
  section?: string
}

/** Parse the `exercise.blocks` field into a typed playlist. */
function parseBlocksPlaylist(raw: unknown): BlockEntry[] {
  if (Array.isArray(raw)) return raw as BlockEntry[]
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) return parsed as BlockEntry[]
    } catch {
      // ignore
    }
  }
  return []
}

/** True when the exercise already has a non-empty sectionRef playlist. */
function hasSectionRefPlaylist(raw: unknown): boolean {
  return parseBlocksPlaylist(raw).some((b) => b.blockType === 'sectionRef')
}

export async function convertLatexBlockOnExercise(
  req: PayloadRequest,
  exerciseId: string,
): Promise<Response> {
  if (!req.user) {
    return Response.json({ success: false, error: 'Authentication required' }, { status: 401 })
  }

  const reqLogger = logger.child({
    requestId: crypto.randomUUID(),
    feature: 'latex_block_convert',
    exerciseId,
  })

  // Fetch the exercise.
  let exercise
  try {
    exercise = await req.payload.findByID({
      collection: 'exercises',
      id: exerciseId,
      depth: 0,
      overrideAccess: true,
      req: { payload: req.payload, user: req.user } as never,
    })
  } catch {
    return Response.json({ success: false, error: 'Exercise not found' }, { status: 404 })
  }

  // Refuse to re-partition an already-sectioned exercise. The endpoint is
  // idempotent over an empty exercise only; running it twice would race the
  // sections collection hook and create a duplicate sectionRef chain.
  if (hasSectionRefPlaylist(exercise.blocks)) {
    return Response.json(
      { success: false, error: 'partition only works on empty exercises' },
      { status: 422 },
    )
  }

  const lessonId =
    typeof exercise.lesson === 'string' ? exercise.lesson : (exercise.lesson as { id: string })?.id

  const blocks = (exercise.content as ContentData | null)?.blocks ?? []
  const latexBlockIndices = blocks
    .map((b, i) => (b.type === 'latex' ? i : -1))
    .filter((i) => i !== -1)

  if (latexBlockIndices.length === 0) {
    return Response.json(
      { success: false, error: 'Exercise has no LaTeX block to convert' },
      { status: 422 },
    )
  }

  const nextBlocks: ContentBlock[] = [...blocks]
  const outcome: ConversionOutcome = {
    convertedBlockIds: [],
    addedBlockCount: 0,
    method: 'script',
    warnings: [],
    errors: [],
  }
  const sourceLatexChunks: string[] = []

  // Iterate right-to-left so splice indices stay valid as we mutate nextBlocks.
  for (let i = latexBlockIndices.length - 1; i >= 0; i--) {
    const idx = latexBlockIndices[i]
    const latexBlock = blocks[idx] as LatexBlock

    // --- Attempt 1: script parser ---
    const result = parseLatexToBlocks(latexBlock.latex)
    outcome.warnings.push(...result.warnings)
    outcome.errors.push(...result.errors)

    const scriptUsable =
      result.blocks.length > 0 &&
      result.errors.length === 0 &&
      isScriptOutputMeaningful(latexBlock.latex, result.blocks)

    if (scriptUsable) {
      // Script succeeded — insert parsed blocks AFTER the LaTeX block, keeping
      // the original LaTeX as a hidden source-of-truth reference in content.
      outcome.convertedBlockIds.push(latexBlock.id)
      outcome.addedBlockCount += result.blocks.length
      sourceLatexChunks.unshift(latexBlock.latex)
      nextBlocks.splice(idx + 1, 0, ...result.blocks)
      continue
    }

    // --- Attempt 2: AI fallback ---
    reqLogger.info(
      {
        blockId: latexBlock.id,
        scriptErrors: result.errors.length,
        scriptBlocks: result.blocks.length,
        scriptUsable,
      },
      'Script parser output not usable, checking AI fallback',
    )

    const fallbackEnabled = await isFallbackEnabled()
    if (!fallbackEnabled) {
      reqLogger.warn({ blockId: latexBlock.id }, 'AI fallback disabled — leaving block untouched')
      continue
    }

    if (!lessonId) {
      reqLogger.warn('Cannot run AI fallback — exercise has no linked lesson')
      continue
    }

    const aiBlocks = await tryAiFallback(req, latexBlock.latex, lessonId, reqLogger)
    if (aiBlocks && aiBlocks.length > 0) {
      outcome.method = 'ai_fallback'
      outcome.convertedBlockIds.push(latexBlock.id)
      outcome.addedBlockCount += aiBlocks.length
      sourceLatexChunks.unshift(latexBlock.latex)
      // Insert AFTER the LaTeX block so the original is preserved.
      nextBlocks.splice(idx + 1, 0, ...aiBlocks)

      emitFallbackAnalytics(req, { lessonId, exerciseId, scriptErrors: result.errors.length })
    } else {
      reqLogger.warn(
        { blockId: latexBlock.id },
        'AI fallback also failed — leaving block untouched',
      )
    }
  }

  if (outcome.convertedBlockIds.length === 0) {
    return Response.json(
      {
        success: false,
        error: 'No LaTeX block could be parsed (script and AI both failed)',
        errors: outcome.errors,
        warnings: outcome.warnings,
      },
      { status: 422 },
    )
  }

  // Persist updated content and sourceLatex.
  const combinedSourceLatex = sourceLatexChunks.join('\n\n% --- %\n\n')

  try {
    // Partition the parsed stream. When at least one question block is
    // present, `exercise.content.blocks` becomes the shared intro and one
    // section is created per question (question always LAST). Trailing
    // non-question blocks attach to the LAST section. When zero questions,
    // the stream stays flat on `exercise.content.blocks` (legacy shape).
    const partition = partitionBlocks(nextBlocks)

    let persistedExerciseId = exerciseId
    let sectionCount = 0
    let sectionIds: string[] = []

    if (partition.isFlat) {
      // Legacy shape: flat stream goes straight onto exercise.content.blocks.
      await req.payload.update({
        collection: 'exercises',
        id: exerciseId,
        data: {
          content: { blocks: nextBlocks as never },
          sourceLatex: combinedSourceLatex,
        },
        draft: true,
        overrideAccess: true,
        req: { payload: req.payload, user: req.user } as never,
      })
    } else {
      // Partitioned shape: shared intro + N sections + sectionRef playlist.
      const sharedBlocks =
        partition.exerciseSharedBlocks.length > 0
          ? partition.exerciseSharedBlocks
          : [emptyPlaceholder()]

      // 1) Trim exercise.content.blocks to the shared intro.
      await req.payload.update({
        collection: 'exercises',
        id: exerciseId,
        data: {
          content: { blocks: sharedBlocks as never },
        },
        draft: true,
        overrideAccess: true,
        req: { payload: req.payload, user: req.user } as never,
      })

      // 2) Create one section per question block. The section afterChange
      //    hook normally pushes the sectionRef into exercise.blocks; we set
      //    `_skipExerciseBlockSync` on the request context so the per-section
      //    appends are skipped and we write the full playlist in a single
      //    follow-up update (matches the migration-script pattern).
      sectionIds = []
      for (const section of partition.sections) {
        const created = await req.payload.create({
          collection: 'sections',
          data: {
            title: section.title,
            exerciseType: 'basic',
            exercise: exerciseId,
            content: { blocks: section.contentBlocks as never },
            order: sectionIds.length,
          },
          draft: true,
          overrideAccess: true,
          req: {
            payload: req.payload,
            user: req.user,
            context: { _skipExerciseBlockSync: true },
          } as never,
        })
        sectionIds.push((created as SectionDoc).id)
        sectionCount++
      }

      // 3) Persist the sectionRef playlist (JSON string) in a single update.
      const playlist: BlockEntry[] = sectionIds.map((sectionId, idx) => ({
        id: `b-${idx}-${Math.random().toString(36).slice(2, 10)}`,
        blockType: 'sectionRef',
        section: sectionId,
      }))
      await req.payload.update({
        collection: 'exercises',
        id: exerciseId,
        data: {
          blocks: JSON.stringify(playlist),
        },
        draft: true,
        overrideAccess: true,
        req: { payload: req.payload, user: req.user } as never,
      })

      // Persist sourceLatex separately so a failure here doesn't undo the
      // partition. (sourceLatex is a convenience field, not structural.)
      try {
        await req.payload.update({
          collection: 'exercises',
          id: exerciseId,
          data: { sourceLatex: combinedSourceLatex },
          draft: true,
          overrideAccess: true,
          req: { payload: req.payload, user: req.user } as never,
        })
      } catch (err) {
        reqLogger.warn(
          { err },
          'Failed to persist sourceLatex after successful partition — continuing',
        )
      }
    }

    reqLogger.info(
      {
        method: outcome.method,
        converted: outcome.convertedBlockIds.length,
        added: outcome.addedBlockCount,
        totalBlocks: nextBlocks.length,
        sectionCount,
        isFlat: partition.isFlat,
      },
      'LaTeX block(s) converted; originals preserved alongside parsed blocks',
    )

    const dataBody: Record<string, unknown> = {
      exerciseId: persistedExerciseId,
      convertedBlockIds: outcome.convertedBlockIds,
      addedBlockCount: outcome.addedBlockCount,
      totalBlocks: nextBlocks.length,
      warnings: outcome.warnings,
      sectionCount,
      isFlat: partition.isFlat,
    }
    if (!partition.isFlat) {
      dataBody.sectionIds = sectionIds
    }
    const responseBody: Record<string, unknown> = {
      success: true,
      method: outcome.method,
      data: dataBody,
    }
    return Response.json(responseBody)
  } catch (err) {
    reqLogger.error({ err }, 'Failed to persist exercise after LaTeX block conversion')
    const message = err instanceof Error ? err.message : 'Failed to save exercise'
    return Response.json({ success: false, error: message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// AI Fallback: call the existing AI import route, harvest blocks, delete temps
// ---------------------------------------------------------------------------

async function tryAiFallback(
  req: PayloadRequest,
  latex: string,
  lessonId: string,
  reqLogger: typeof logger,
): Promise<ContentBlock[] | null> {
  try {
    const origin = deriveOrigin(req)
    const cookie = req.headers?.get?.('cookie') || ''

    const aiResponse = await fetch(`${origin}/api/exercises/import-latex-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ latex, lessonId }),
    })

    if (!aiResponse.ok) {
      reqLogger.warn({ status: aiResponse.status }, 'AI import route returned non-OK')
      return null
    }

    const aiData = (await aiResponse.json()) as {
      success: boolean
      data?: { exerciseIds: string[]; exerciseCount: number }
    }

    if (!aiData.success || !aiData.data?.exerciseIds?.length) {
      return null
    }

    // Harvest blocks from the temp exercise(s) the AI route created.
    const allBlocks: ContentBlock[] = []
    const tempIds = aiData.data.exerciseIds

    for (const tempId of tempIds) {
      try {
        const tempExercise = await req.payload.findByID({
          collection: 'exercises',
          id: tempId,
          depth: 0,
          overrideAccess: true,
        })
        const tempContent = tempExercise.content as ContentData | null
        if (tempContent?.blocks) {
          allBlocks.push(...tempContent.blocks)
        }
      } catch {
        reqLogger.warn({ tempId }, 'Could not read temp exercise from AI fallback')
      }
    }

    // Clean up temp exercises — they were scaffolding for this in-place conversion.
    for (const tempId of tempIds) {
      try {
        await req.payload.delete({
          collection: 'exercises',
          id: tempId,
          overrideAccess: true,
        })
      } catch {
        reqLogger.warn({ tempId }, 'Could not delete temp exercise from AI fallback')
      }
    }

    reqLogger.info(
      { tempExercises: tempIds.length, harvestedBlocks: allBlocks.length },
      'AI fallback produced blocks',
    )

    return allBlocks.length > 0 ? allBlocks : null
  } catch (err) {
    reqLogger.error({ err }, 'AI fallback threw unexpectedly')
    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function isFallbackEnabled(): Promise<boolean> {
  try {
    const value = await getConfigValueByKey<boolean | string | undefined>(
      ConfigDomain.LatexConversion,
      'fallback_enabled',
      { defaultValue: true, throwIfNotFound: false },
    )
    if (value === false || value === 'false') return false
    return true
  } catch {
    return true // fail open
  }
}

function deriveOrigin(req: PayloadRequest): string {
  try {
    if (req.url) {
      const u = new URL(req.url)
      return `${u.protocol}//${u.host}`
    }
  } catch {
    // fall through
  }
  return process.env.NEXT_PUBLIC_SERVER_URL || 'http://localhost:3000'
}

/**
 * Sanity-check that the script parser produced meaningful output.
 * If the total text content of all parsed blocks is tiny compared to the
 * source LaTeX, the parser likely dropped most of the content and we should
 * fall through to AI instead of persisting garbage.
 */
function isScriptOutputMeaningful(sourceLatex: string, parsedBlocks: ContentBlock[]): boolean {
  const totalContent = parsedBlocks
    .map((b) => {
      if ('value' in b && typeof b.value === 'string') return b.value
      if ('latex' in b && typeof b.latex === 'string') return b.latex
      return ''
    })
    .join('')

  // If source is non-trivial but output captured less than 10% of it, it's garbage.
  if (sourceLatex.length > 50 && totalContent.length < sourceLatex.length * 0.1) {
    return false
  }

  // If output is under 10 chars total regardless, it's garbage.
  if (totalContent.length < 10) {
    return false
  }

  return true
}

function emitFallbackAnalytics(
  req: PayloadRequest,
  props: { lessonId: string; exerciseId: string; scriptErrors: number },
): void {
  logger.info(
    {
      event: 'latex_import_fallback',
      lessonId: props.lessonId,
      exerciseId: props.exerciseId,
      scriptErrors: props.scriptErrors,
      userId: req.user?.id,
    },
    'latex_import_fallback',
  )
}
