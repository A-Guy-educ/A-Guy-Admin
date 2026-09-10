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

// Display size to percentage mapping
const SIZE_MAP = {
  small: 0.33,
  medium: 0.5,
  large: 0.75,
  full: 1,
} as const

export type DisplaySize = 'small' | 'medium' | 'large' | 'full'

interface AxisRendererProps {
  blockId: string
  spec: AxisSpecV1
  displaySize?: DisplaySize
}

export function AxisRenderer({ blockId, spec, displaySize = 'full' }: AxisRendererProps) {
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

    const percentage = SIZE_MAP[displaySize]

    const recompute = () => {
      const availableWidth = container.clientWidth * percentage
      const size = computeBoardSize({
        xRange: viewportSignature.xRange,
        yRange: viewportSignature.yRange,
        availableWidth,
        proportion,
        maxWidth: 600,
        maxHeight: 600,
        minWidth: 200,
        minHeight: 200,
      })
      setDimensions(size)
    }

    recompute()
    const resizeObserver = new ResizeObserver(recompute)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [displaySize, viewportSignature.xRange, viewportSignature.yRange, proportion])

  // Determine container width style based on displaySize
  const containerWidth = displaySize === 'full' ? 'w-full' : ''

  return (
    <div className={`my-4 flex justify-center ${containerWidth}`} ref={containerRef}>
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
        className="border-border"
      />
    </div>
  )
}
