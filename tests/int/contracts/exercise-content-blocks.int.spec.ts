import { ContentBlockSchema } from '@/server/payload/collections/Exercises/schemas'
import { describe, expect, it } from 'vitest'

describe('HtmlBlockSchema', () => {
  it('allows full HTML documents for sandboxed rendering', () => {
    const block = {
      id: 'html1',
      type: 'html',
      html: `זסזס<!DOCTYPE html>
        <html lang="he" dir="rtl">
          <head>
            <script src="https://cdn.tailwindcss.com"></script>
            <style>.x { color: red; }</style>
          </head>
          <body class="bg-white">
            <main style="padding: 24px;">שלום</main>
          </body>
        </html>`,
    }

    expect(() => ContentBlockSchema.parse(block)).not.toThrow()
  })
})

describe('QuestionMatchingBlockSchema', () => {
  it('validates a matching question with correct structure', () => {
    const matchingBlock = {
      id: 'm1',
      type: 'question_matching',
      prompt: {
        type: 'rich_text',
        format: 'md-math-v1',
        value: 'Match the following equations to their solutions:',
      },
      leftColumn: [
        {
          id: 'l1',
          content: { type: 'rich_text', format: 'md-math-v1', value: '2 + 2' },
        },
        {
          id: 'l2',
          content: { type: 'rich_text', format: 'md-math-v1', value: '3 + 3' },
        },
      ],
      rightColumn: [
        {
          id: 'r1',
          content: { type: 'rich_text', format: 'md-math-v1', value: '4' },
        },
        {
          id: 'r2',
          content: { type: 'rich_text', format: 'md-math-v1', value: '6' },
        },
      ],
      correctPairs: [
        { optionId: 'l1', matchId: 'r1' },
        { optionId: 'l2', matchId: 'r2' },
      ],
      shuffleRightColumn: true,
    }
    expect(() => ContentBlockSchema.parse(matchingBlock)).not.toThrow()
  })

  it('rejects matching with unknown optionId in correctPairs', () => {
    const invalidMatching = {
      id: 'm1',
      type: 'question_matching',
      prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Match:' },
      leftColumn: [{ id: 'l1', content: { type: 'rich_text', format: 'md-math-v1', value: 'A' } }],
      rightColumn: [{ id: 'r1', content: { type: 'rich_text', format: 'md-math-v1', value: 'B' } }],
      correctPairs: [{ optionId: 'unknown', matchId: 'r1' }],
    }
    expect(() => ContentBlockSchema.parse(invalidMatching)).toThrow()
  })

  it('rejects matching with unknown matchId in correctPairs', () => {
    const invalidMatching = {
      id: 'm1',
      type: 'question_matching',
      prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Match:' },
      leftColumn: [{ id: 'l1', content: { type: 'rich_text', format: 'md-math-v1', value: 'A' } }],
      rightColumn: [{ id: 'r1', content: { type: 'rich_text', format: 'md-math-v1', value: 'B' } }],
      correctPairs: [{ optionId: 'l1', matchId: 'unknown' }],
    }
    expect(() => ContentBlockSchema.parse(invalidMatching)).toThrow()
  })

  it('rejects matching with less than 2 leftColumn items', () => {
    const invalidMatching = {
      id: 'm1',
      type: 'question_matching',
      prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Match:' },
      leftColumn: [{ id: 'l1', content: { type: 'rich_text', format: 'md-math-v1', value: 'A' } }],
      rightColumn: [{ id: 'r1', content: { type: 'rich_text', format: 'md-math-v1', value: 'B' } }],
      correctPairs: [{ optionId: 'l1', matchId: 'r1' }],
    }
    expect(() => ContentBlockSchema.parse(invalidMatching)).toThrow()
  })
})

describe('SvgBlockSchema', () => {
  it('validates an SVG block with correct structure', () => {
    const svgBlock = {
      id: 's1',
      type: 'svg',
      value: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
      altText: 'A simple circle',
      caption: {
        type: 'rich_text',
        format: 'md-math-v1',
        value: 'Figure 1: Circle diagram',
      },
    }
    expect(() => ContentBlockSchema.parse(svgBlock)).not.toThrow()
  })

  it('validates an SVG block without optional fields', () => {
    const svgBlock = {
      id: 's1',
      type: 'svg',
      value: '<svg><rect width="100" height="100"/></svg>',
    }
    expect(() => ContentBlockSchema.parse(svgBlock)).not.toThrow()
  })

  it('rejects SVG block with empty value', () => {
    const invalidSvg = {
      id: 's1',
      type: 'svg',
      value: '',
    }
    expect(() => ContentBlockSchema.parse(invalidSvg)).toThrow()
  })
})

describe('QuestionGeometryBlockSchema', () => {
  it('validates a geometry question with correct structure', () => {
    const geometryBlock = {
      id: 'g1',
      type: 'question_geometry',
      prompt: {
        type: 'rich_text',
        format: 'md-math-v1',
        value: 'Construct a triangle with the given properties:',
      },
      geometry: {
        kind: 'euclidean',
        canvas: {
          width: 800,
          height: 600,
          background: '#ffffff',
          grid: true,
        },
        elements: {
          points: [
            { name: 'A', x: 100, y: 100, position: 'tr' },
            { name: 'B', x: 300, y: 100, position: 'tl' },
            { name: 'C', x: 200, y: 300, position: 'm' },
          ],
          lines: [
            { from: 'A', to: 'B', style: 'solid', label: { value: 'c', position: 'm' } },
            { from: 'B', to: 'C', style: 'solid' },
            { from: 'C', to: 'A', style: 'solid' },
          ],
          circles: [],
          angles: [{ center: 'A', ray1: 'B', ray2: 'C', arcRadius: 20 }],
        },
      },
    }
    expect(() => ContentBlockSchema.parse(geometryBlock)).not.toThrow()
  })

  it('rejects geometry with invalid kind', () => {
    const invalidGeometry = {
      id: 'g1',
      type: 'question_geometry',
      prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Draw:' },
      geometry: {
        kind: 'invalid',
        canvas: { width: 800, height: 600 },
        elements: { points: [], lines: [], circles: [], angles: [] },
      },
    }
    expect(() => ContentBlockSchema.parse(invalidGeometry)).toThrow()
  })
})

describe('QuestionAxisBlockSchema', () => {
  it('validates an axis question with correct structure', () => {
    const axisBlock = {
      id: 'a1',
      type: 'question_axis',
      prompt: {
        type: 'rich_text',
        format: 'md-math-v1',
        value: 'Plot the function f(x) = x² on the coordinate system:',
      },
      axis: {
        kind: 'cartesian',
        units: 20,
        grid: { enabled: true, color: '#e0e0e0' },
        axes: {
          axisColor: '#000000',
          numberColor: '#333333',
          labelColor: '#000000',
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
        elements: {
          points: [],
          graphs: [
            {
              id: 'g1',
              fn: 'x^2',
              style: 'solid',
              thickness: 2,
              color: '#2196F3',
            },
          ],
          asymptotesVertical: [],
          asymptotesHorizontal: [],
        },
      },
    }
    expect(() => ContentBlockSchema.parse(axisBlock)).not.toThrow()
  })

  it('rejects axis with invalid kind', () => {
    const invalidAxis = {
      id: 'a1',
      type: 'question_axis',
      prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Plot:' },
      axis: {
        kind: 'spherical',
        units: 20,
        grid: { enabled: true },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: { points: [], graphs: [] },
      },
    }
    expect(() => ContentBlockSchema.parse(invalidAxis)).toThrow()
  })

  it('validates axis with graph painting', () => {
    const axisWithPaint = {
      id: 'a1',
      type: 'question_axis',
      prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Shade the region:' },
      axis: {
        kind: 'cartesian',
        units: 10,
        grid: { enabled: false },
        axes: {
          showNumbers: true,
          showLabels: true,
          ticks: 1,
          labels: { x: 'x', y: 'y' },
          origin: { x: 0, y: 0 },
        },
        elements: {
          points: [],
          graphs: [
            {
              id: 'g1',
              fn: 'x',
              style: 'solid',
              thickness: 2,
              paint: {
                underGraph: [{ fromX: 0, toX: 5, fillColor: 'lightblue' }],
              },
            },
          ],
        },
      },
    }
    expect(() => ContentBlockSchema.parse(axisWithPaint)).not.toThrow()
  })
})

describe('showNotebook per-block toggle', () => {
  const notebookHosts = [
    {
      name: 'question_select true_false',
      block: {
        id: 'tf1',
        type: 'question_select',
        variant: 'true_false',
        selectionMode: 'single',
        prompt: { type: 'rich_text', format: 'md-math-v1', value: '2 + 2 = 4' },
        options: [
          {
            id: 'true',
            value: true,
            label: { type: 'rich_text', format: 'md-math-v1', value: 'True' },
          },
          {
            id: 'false',
            value: false,
            label: { type: 'rich_text', format: 'md-math-v1', value: 'False' },
          },
        ],
        answer: { correctOptionId: 'true' },
      },
    },
    {
      name: 'question_select mcq',
      block: {
        id: 'mcq1',
        type: 'question_select',
        variant: 'mcq',
        selectionMode: 'single',
        prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Pick one:' },
        answer: {
          multiSelect: false,
          options: [
            { id: 'a', content: { type: 'rich_text', format: 'md-math-v1', value: 'A' } },
            { id: 'b', content: { type: 'rich_text', format: 'md-math-v1', value: 'B' } },
          ],
          correctOptionIds: ['a'],
        },
      },
    },
    {
      name: 'question_free_response',
      block: {
        id: 'fr1',
        type: 'question_free_response',
        prompt: { type: 'rich_text', format: 'md-math-v1', value: 'What is 2 + 2?' },
        answer: { acceptedAnswers: ['4'] },
      },
    },
    {
      name: 'question_table',
      block: {
        id: 't1',
        type: 'question_table',
        prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Fill in:' },
        table: {
          headers: ['a', 'b'],
          rowsData: [['1', '2']],
        },
      },
    },
    {
      name: 'question_matching',
      block: {
        id: 'match1',
        type: 'question_matching',
        prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Match:' },
        leftColumn: [
          { id: 'l1', content: { type: 'rich_text', format: 'md-math-v1', value: 'A' } },
          { id: 'l2', content: { type: 'rich_text', format: 'md-math-v1', value: 'B' } },
        ],
        rightColumn: [
          { id: 'r1', content: { type: 'rich_text', format: 'md-math-v1', value: '1' } },
          { id: 'r2', content: { type: 'rich_text', format: 'md-math-v1', value: '2' } },
        ],
        correctPairs: [
          { optionId: 'l1', matchId: 'r1' },
          { optionId: 'l2', matchId: 'r2' },
        ],
      },
    },
  ] as const

  for (const { name, block } of notebookHosts) {
    it(`${name}: accepts showNotebook: true`, () => {
      const result = ContentBlockSchema.safeParse({ ...block, showNotebook: true })
      expect(result.success).toBe(true)
    })

    it(`${name}: accepts showNotebook: false`, () => {
      const result = ContentBlockSchema.safeParse({ ...block, showNotebook: false })
      expect(result.success).toBe(true)
    })

    it(`${name}: accepts omitted showNotebook (backward-compat)`, () => {
      const result = ContentBlockSchema.safeParse(block)
      expect(result.success).toBe(true)
    })

    it(`${name}: rejects non-boolean showNotebook`, () => {
      const result = ContentBlockSchema.safeParse({ ...block, showNotebook: 'yes' })
      expect(result.success).toBe(false)
    })
  }

  it('question_geometry: rejects showNotebook (strict mode, no toggle for graph blocks)', () => {
    const block = {
      id: 'g1',
      type: 'question_geometry',
      prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Draw:' },
      geometry: {
        kind: 'euclidean',
        canvas: { width: 400, height: 400 },
        elements: { points: [], lines: [], circles: [], angles: [] },
      },
      showNotebook: true,
    }
    const result = ContentBlockSchema.safeParse(block)
    expect(result.success).toBe(false)
  })
})

describe('ExerciseContent with new block types', () => {
  it('validates content containing a matching block', () => {
    const content = {
      blocks: [
        {
          id: 'intro',
          type: 'rich_text',
          format: 'md-math-v1',
          value: 'Match the terms with their definitions:',
        },
        {
          id: 'm1',
          type: 'question_matching',
          prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Complete the matching:' },
          leftColumn: [
            { id: 'l1', content: { type: 'rich_text', format: 'md-math-v1', value: 'Square' } },
            { id: 'l2', content: { type: 'rich_text', format: 'md-math-v1', value: 'Circle' } },
          ],
          rightColumn: [
            {
              id: 'r1',
              content: { type: 'rich_text', format: 'md-math-v1', value: '4 equal sides' },
            },
            {
              id: 'r2',
              content: {
                type: 'rich_text',
                format: 'md-math-v1',
                value: 'All points equidistant from center',
              },
            },
          ],
          correctPairs: [
            { optionId: 'l1', matchId: 'r1' },
            { optionId: 'l2', matchId: 'r2' },
          ],
        },
      ],
    }
    expect(() => ContentBlockSchema.parse(content.blocks[0])).not.toThrow()
  })

  it('validates content containing SVG, geometry, and axis blocks', () => {
    const content = {
      blocks: [
        {
          id: 'diagram',
          type: 'svg',
          value: '<svg><rect width="100" height="100"/></svg>',
        },
        {
          id: 'geo1',
          type: 'question_geometry',
          prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Construct:' },
          geometry: {
            kind: 'euclidean',
            canvas: { width: 800, height: 600 },
            elements: { points: [], lines: [], circles: [], angles: [] },
          },
        },
        {
          id: 'axis1',
          type: 'question_axis',
          prompt: { type: 'rich_text', format: 'md-math-v1', value: 'Graph:' },
          axis: {
            kind: 'cartesian',
            units: 20,
            grid: { enabled: true },
            axes: {
              showNumbers: true,
              showLabels: true,
              ticks: 1,
              labels: { x: 'x', y: 'y' },
              origin: { x: 0, y: 0 },
            },
            elements: { points: [], graphs: [] },
          },
        },
      ],
    }
    // Test each block type individually
    expect(() => ContentBlockSchema.parse(content.blocks[0])).not.toThrow()
    expect(() => ContentBlockSchema.parse(content.blocks[1])).not.toThrow()
    expect(() => ContentBlockSchema.parse(content.blocks[2])).not.toThrow()
  })
})
