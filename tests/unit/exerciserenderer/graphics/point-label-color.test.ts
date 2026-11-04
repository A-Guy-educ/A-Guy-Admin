import { describe, expect, it, vi } from 'vitest'
import type { AxisSpecV1, GeometrySpecV1 } from '@/infra/contracts'
import { renderAxisSpec } from '@/ui/shared/exerciserenderer/graphics/axisElements'
import { renderGeometrySpec } from '@/ui/shared/exerciserenderer/graphics/geometryElements'

type CreateCall = [string, unknown, Record<string, unknown>]

const mockBoard = () => {
  const create = vi.fn(() => ({ on: vi.fn(), setAttribute: vi.fn() }))
  return { board: { create } as unknown as JXG.Board, create }
}

const pointLabelColors = (create: ReturnType<typeof vi.fn>) =>
  (create.mock.calls as unknown as CreateCall[])
    .filter(([type]) => type === 'point')
    .map(([, , attrs]) => ({
      dot: attrs.strokeColor,
      label: (attrs.label as Record<string, unknown>).strokeColor,
    }))

describe('point label color matches the dot', () => {
  it('geometry renderer', () => {
    const { board, create } = mockBoard()
    const spec: GeometrySpecV1 = {
      kind: 'euclidean',
      canvas: { width: 400, height: 300 },
      elements: {
        points: [{ name: 'A', x: 1, y: 1, color: '#dc2626' }],
        lines: [],
        circles: [],
        angles: [],
      },
    }
    renderGeometrySpec(board, spec)
    expect(pointLabelColors(create)).toEqual([{ dot: '#dc2626', label: '#dc2626' }])
  })

  it('axis renderer, including the default color', () => {
    const { board, create } = mockBoard()
    const spec: AxisSpecV1 = {
      kind: 'cartesian',
      units: 1,
      grid: { enabled: false },
      axes: {
        showNumbers: false,
        showLabels: false,
        ticks: 1,
        labels: { x: 'x', y: 'y' },
        origin: { x: 0, y: 0 },
      },
      viewportMode: 'auto',
      elements: {
        points: [
          { x: 1, y: 1, label: 'A', type: 'point', color: '#16a34a' },
          { x: 2, y: 2, label: 'B', type: 'hole' },
        ],
        graphs: [],
      },
    }
    renderAxisSpec(board, spec)
    const colors = pointLabelColors(create)
    expect(colors[0]).toEqual({ dot: '#16a34a', label: '#16a34a' })
    expect(colors[1].label).toBe(colors[1].dot)
    expect(colors[1].label).toBeTruthy()
  })
})
