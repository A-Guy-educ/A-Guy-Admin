/**
 * Exercise Contracts - Zod schemas and TypeScript types
 *
 * Shared contract layer for Exercise content, Answer specifications,
 * and Graphics specifications (Axis & Geometry).
 *
 * Usable by both server (Payload hooks) and client (renderers/editors).
 */

// Primitives
export {
  BlockIdSchema,
  ColorStringSchema,
  PositionEnumSchema,
  LineStyleSchema,
  type BlockId,
  type ColorString,
  type PositionEnum,
  type LineStyle,
} from './primitives'

// Graphics - Shared Interaction
export {
  InteractionToolSchema,
  EvaluationModeSchema,
  InteractionSpecBaseSchema,
  type InteractionTool,
  type EvaluationMode,
  type InteractionSpecBase,
} from './graphics/interaction.base'

// Graphics - Axis
export { AxisSpecV1Schema, type AxisSpecV1 } from './graphics/axis.v1'

// Graphics - Geometry
export { GeometrySpecV1Schema, type GeometrySpecV1 } from './graphics/geometry.v1'

// Exercise - Content (Block Types)
export {
  ExerciseBlockSchema,
  type ExerciseBlock,
  type ExerciseBlockLevel2,
  type ExerciseBlockLevel3,
  type LeafBlock,
  type RichTextBlock,
  type FigureBlock,
  type TableBlock,
  type AxisSystemBlock,
  type GeometryBlock,
  type SectionBlock,
} from './exercise/blocks'

// Exercise - Content Schema (Simplified)
export { ExerciseContentSchema, type ExerciseContent } from './exercise/content'

// Exercise - Answers
export {
  AnswerSpecSchema,
  type AnswerSpec,
  type McqAnswerSpec,
  type TrueFalseAnswerSpec,
  type FreeResponseAnswerSpec,
  type FreeResponseNumeric,
  type FreeResponseAlgebraic,
  type FreeResponseText,
} from './exercise/answers'
