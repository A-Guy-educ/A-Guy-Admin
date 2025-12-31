import { z } from 'zod'
import { BlockIdSchema } from '../primitives'
import { AxisSpecV1Schema } from '../graphics/axis.v1'
import { GeometrySpecV1Schema } from '../graphics/geometry.v1'

/**
 * Exercise Block Schemas (v1)
 *
 * Implements a strict, depth-limited block structure.
 * - Max nesting depth: 3
 * - Explicit unwrapping for recursion control
 * - "Leaf" blocks (RichText, Figure, etc.)
 * - "Container" blocks (Section)
 */

// --- Leaf Blocks ---

/** Rich text (Markdown + Math) */
const RichTextBlockSchema = z
  .object({
    id: BlockIdSchema,
    type: z.literal('rich_text'),
    format: z.literal('md-math-v1'),
    value: z.string().min(1),
  })
  .strict()

/** Figure (Image/Asset) */
const FigureBlockSchema = z
  .object({
    id: BlockIdSchema,
    type: z.literal('figure'),
    assetId: z.string().min(1),
    caption: z.string().optional(),
    alt: z.string().optional(),
  })
  .strict()

/** Table */
const TableBlockSchema = z
  .object({
    id: BlockIdSchema,
    type: z.literal('table'),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
    showBorders: z.boolean(),
    showHeader: z.boolean(),
    columnAlignment: z.array(z.enum(['left', 'center', 'right'])),
  })
  .strict()
  .superRefine((data, ctx) => {
    for (let i = 0; i < data.rows.length; i++) {
      if (data.rows[i].length !== data.headers.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Row ${i} has ${data.rows[i].length} columns but headers has ${data.headers.length}`,
          path: ['rows', i],
        })
      }
    }
  })

/** Axis System */
const AxisSystemBlockSchema = z
  .object({
    id: BlockIdSchema,
    type: z.literal('axis_system'),
    specVersion: z.literal(1),
    spec: AxisSpecV1Schema,
  })
  .strict()

/** Geometry */
const GeometryBlockSchema = z
  .object({
    id: BlockIdSchema,
    type: z.literal('geometry'),
    specVersion: z.literal(1),
    spec: GeometrySpecV1Schema,
  })
  .strict()

// Union of all Leaf Blocks
const LeafBlockSchema = z.discriminatedUnion('type', [
  RichTextBlockSchema,
  FigureBlockSchema,
  TableBlockSchema,
  AxisSystemBlockSchema,
  GeometryBlockSchema,
])

export type LeafBlock = z.infer<typeof LeafBlockSchema>

// --- Container Blocks (Recursive with Depth Limit) ---

// Level 3 (Deepest): Can only contain Leaves. No Sections.
const ExerciseBlockLevel3Schema = LeafBlockSchema

// Level 2: Can contain Sections (which contain Level 3) OR Leaves
const SectionBlockLevel3Schema = z
  .object({
    id: BlockIdSchema,
    type: z.literal('section'),
    label: z.string().optional(),
    title: z.string().optional(),
    blocks: z.array(ExerciseBlockLevel3Schema),
  })
  .strict()

const ExerciseBlockLevel2Schema = z.union([LeafBlockSchema, SectionBlockLevel3Schema])

// Level 1 (Top): Can contain Sections (which contain Level 2) OR Leaves
const SectionBlockLevel2Schema = z
  .object({
    id: BlockIdSchema,
    type: z.literal('section'),
    label: z.string().optional(),
    title: z.string().optional(),
    blocks: z.array(ExerciseBlockLevel2Schema),
  })
  .strict()

// Root Block Type
export const ExerciseBlockSchema = z.union([LeafBlockSchema, SectionBlockLevel2Schema])

export type ExerciseBlock = z.infer<typeof ExerciseBlockSchema>

// Export specific levels if needed for recursive rendering components
// (Internal use mainly, but good to have available)
export type ExerciseBlockLevel2 = z.infer<typeof ExerciseBlockLevel2Schema>
export type ExerciseBlockLevel3 = z.infer<typeof ExerciseBlockLevel3Schema>

// Export specific block types for convenience
export type RichTextBlock = z.infer<typeof RichTextBlockSchema>
export type FigureBlock = z.infer<typeof FigureBlockSchema>
export type TableBlock = z.infer<typeof TableBlockSchema>
export type AxisSystemBlock = z.infer<typeof AxisSystemBlockSchema>
export type GeometryBlock = z.infer<typeof GeometryBlockSchema>
export type SectionBlock = z.infer<typeof SectionBlockLevel2Schema>
