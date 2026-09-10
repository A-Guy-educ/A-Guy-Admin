import { generateId } from '@/server/payload/collections/Exercises/types'
import type {
  RichTextBlock,
  LatexBlock,
  QuestionSelectMcqBlock,
  QuestionFreeResponseBlock,
  QuestionTableBlock,
  QuestionAxisBlock,
  QuestionGeometryBlock,
  QuestionMultiAxisBlock,
  InlineRichText,
} from '@/server/payload/collections/Exercises/types'
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'
import type { GeometrySpecV1 } from '@/infra/contracts/graphics/geometry.v1'

export function makeRichTextBlock(value: string): RichTextBlock {
  return {
    id: generateId(),
    type: 'rich_text',
    format: 'md-math-v1',
    value,
    mediaIds: [],
  }
}

export function makeLatexBlock(latex: string): LatexBlock {
  return {
    id: generateId(),
    type: 'latex',
    latex,
    renderMode: 'block',
  }
}

export function makeInlineRichText(value: string): InlineRichText {
  return {
    type: 'rich_text',
    format: 'md-math-v1',
    value,
    mediaIds: [],
  }
}

export function makeFreeResponseBlock(
  prompt: string,
  solution?: string,
  fullSolution?: string,
): QuestionFreeResponseBlock {
  return {
    id: generateId(),
    type: 'question_free_response',
    prompt: makeInlineRichText(prompt),
    answer: { acceptedAnswers: ['__imported__'] },
    ...(solution && { solution: makeInlineRichText(solution) }),
    ...(fullSolution && { fullSolution: makeInlineRichText(fullSolution) }),
  }
}

export function makeTableBlock(
  prompt: string,
  headers: string[],
  rows: string[][],
): QuestionTableBlock {
  return {
    id: generateId(),
    type: 'question_table',
    prompt: makeInlineRichText(prompt),
    table: {
      solutionFill: false,
      headers,
      rowsData: rows,
      answers: undefined,
      showBorders: true,
      showHeader: true,
    },
  }
}

export function makeAxisBlock(prompt: string, axis: AxisSpecV1): QuestionAxisBlock {
  return {
    id: generateId(),
    type: 'question_axis',
    prompt: makeInlineRichText(prompt),
    axis,
  }
}

export function makeGeometryBlock(prompt: string, geometry: GeometrySpecV1): QuestionGeometryBlock {
  return {
    id: generateId(),
    type: 'question_geometry',
    prompt: makeInlineRichText(prompt),
    geometry,
  }
}

/**
 * Build a `question_multi_axis` block from an array of pre-parsed axis blocks.
 * Used when a tabular contains multiple `\begin{tikzpicture}\begin{axis}…`
 * blocks side-by-side — the author's shape for "compare graphs A/B/C/D" or
 * "which of these matches the function?". The `columnsPerRow` follows the
 * schema's 1/2/4 options (author's typical shape is a 1×2, 1×3, 2×2, or
 * 1×4 grid); we always emit `4` so a 3-graph row still uses the wide layout.
 */
export function makeMultiAxisBlock(
  axes: AxisSpecV1[],
  columnsPerRow: 1 | 2 | 4 = 4,
): QuestionMultiAxisBlock {
  return {
    id: generateId(),
    type: 'question_multi_axis',
    textPosition: 'above',
    columnsPerRow,
    graphs: axes.map((axis, idx) => ({
      id: generateId(),
      label: String.fromCharCode(65 + idx), // A, B, C, D…
      axis,
      order: idx,
    })),
  }
}

export function makeMcqBlock(
  prompt: string,
  options: Array<{ text: string; isCorrect: boolean }>,
): QuestionSelectMcqBlock {
  const mcqOptions = options.map((opt) => ({
    id: generateId(),
    content: makeInlineRichText(opt.text),
  }))

  const correctIds = mcqOptions.filter((_, i) => options[i].isCorrect).map((o) => o.id)

  return {
    id: generateId(),
    type: 'question_select',
    variant: 'mcq',
    selectionMode: correctIds.length > 1 ? 'multiple' : 'single',
    prompt: makeInlineRichText(prompt),
    answer: {
      multiSelect: correctIds.length > 1,
      options: mcqOptions,
      correctOptionIds: correctIds.length > 0 ? correctIds : [mcqOptions[0].id],
    },
  }
}
