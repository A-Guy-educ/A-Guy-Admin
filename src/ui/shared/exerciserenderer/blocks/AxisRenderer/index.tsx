'use client'

import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { AxisSpecV1 } from '@/infra/contracts'
import { renderAxisSpec } from '../../graphics/axisElements'
import { resolveViewport } from '@/infra/utils/graphics/viewport-utils'
import { computeBoardSize } from '@/infra/utils/graphics/board-sizing'

const JSXGraphBoard = dynamic(
  () => import('../../graphics/JSXGraphBoard').then((m) => ({ default: m.JSXGraphBoard })),
  {
    ssr: false,
    loading: () => <div className="w-full h-64 bg-muted animate-pulse rounded-lg" />,
  },
)

// Legacy display-size enum kept for backward compatibility — the renderer
// no longer multiplies the container width by this value. Sizing is now a
// single container-relative rule in `board-sizing.ts` (fixed 330px height,
// aspect-driven width, min 280px, max 75% of container).
export type DisplaySize = 'xsmall' | 'small' | 'medium' | 'large' | 'full'

interface AxisRendererProps {
  blockId: string
  spec: AxisSpecV1
  /** Legacy — see note on `DisplaySize` above. Unused in sizing math. */
  displaySize?: DisplaySize
}

export function AxisRenderer({ blockId, spec }: AxisRendererProps) {
  // Guard against callers that pass an axis block with a missing `axis` field.
  // Previously `renderAxisSpec(board, undefined)` threw `Cannot read
  // properties of undefined (reading 'elements')` and crashed the whole
  // exercise page.
  const hasSpec = !!spec && !!spec.elements

  const handleBoardReady = useCallback(
    (board: JXG.Board) => {
      if (!hasSpec) return
      renderAxisSpec(board, spec)
    },
    [spec, hasSpec],
  )

  const boundingBox = useMemo<[number, number, number, number]>(() => {
    if (!hasSpec) return [-5, 5, 5, -5]
    const resolved = resolveViewport(spec)
    return [resolved.xMin, resolved.yMax, resolved.xMax, resolved.yMin]
  }, [spec, hasSpec])

  // Container ref for responsive sizing
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 400, height: 400 })

  // Recompute board size when the viewport, proportion, or requested display
  // size changes — the container aspect ratio is derived from the viewport
  // so grid squares stay square and unit circles stay circular. Previously
  // this was hardcoded to 600x400, which forced x-units to render ~1.5x
  // wider than y-units regardless of the viewport.
  const proportion = spec?.proportion ?? 1
  const viewportSignature = useMemo(() => {
    if (!hasSpec) return { xRange: 20, yRange: 20 }
    const v = resolveViewport(spec)
    return { xRange: v.xMax - v.xMin, yRange: v.yMax - v.yMin }
  }, [spec, hasSpec])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const recompute = () => {
      // Pass the raw container width — board-sizing now handles the
      // 75%-of-container cap, min width, and narrow-screen fallbacks
      // internally. `displaySize` is intentionally unused here: the spec
      // uses a single container-relative max rather than per-block scales.
      const size = computeBoardSize({
        xRange: viewportSignature.xRange,
        yRange: viewportSignature.yRange,
        availableWidth: container.clientWidth,
        proportion,
      })
      setDimensions(size)
    }

    recompute()
    const resizeObserver = new ResizeObserver(recompute)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [viewportSignature.xRange, viewportSignature.yRange, proportion])

  return (
    <div className="my-4 flex justify-center w-full" ref={containerRef}>
      <JSXGraphBoard
        id={blockId}
        width={dimensions.width}
        height={dimensions.height}
        boundingBox={boundingBox}
        showGrid={spec.grid.enabled}
        showAxis
        axisConfig={{
          showNumbers: spec.axes.showNumbers,
          showLabels: spec.axes.showLabels,
          ticks: spec.axes.ticks,
          labels: spec.axes.labels,
          tickPosition: spec.axes.tickPosition ?? { x: 'default', y: 'default' },
          origin: spec.axes.origin,
        }}
        onBoardReady={handleBoardReady}
        interactive={spec.interactive !== false}
        className="border-border"
      />
    </div>
  )
}
