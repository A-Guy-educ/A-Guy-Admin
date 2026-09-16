'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { GeometrySpecV1 } from '@/infra/contracts'
import { renderGeometrySpec } from '../../graphics/geometryElements'
import { computeBoardSize } from '@/infra/utils/graphics/board-sizing'
import type { DisplaySize } from '../AxisRenderer'

const JSXGraphBoard = dynamic(
  () => import('../../graphics/JSXGraphBoard').then((m) => ({ default: m.JSXGraphBoard })),
  {
    ssr: false,
    loading: () => <div className="w-full h-64 bg-muted animate-pulse rounded-lg" />,
  },
)

/**
 * Percentage of the surrounding container the board should occupy. Matches
 * `SIZE_MAP` in AxisRenderer so all three sketch blocks share the same
 * "25 / 50 / 75 / 100 %" scale.
 */
const GEOMETRY_SIZE_MAP: Record<DisplaySize, number> = {
  small: 0.25,
  medium: 0.5,
  large: 0.75,
  full: 1,
}

interface GeometryRendererProps {
  blockId: string
  spec: GeometrySpecV1
  displaySize?: DisplaySize
}

export function GeometryRenderer({
  blockId,
  spec,
  displaySize = 'full',
}: GeometryRendererProps) {
  const handleBoardReady = useCallback(
    (board: JXG.Board) => {
      renderGeometrySpec(board, spec)
    },
    [spec],
  )

  const { canvas } = spec
  const boundingBox = useMemo<[number, number, number, number]>(
    () => canvas.boundingBox ?? [0, canvas.height, canvas.width, 0],
    [canvas.boundingBox, canvas.width, canvas.height],
  )

  // JSXGraphBoard's init useEffect depends on `[id]` only — once the board is
  // created for a given block id, it never re-inits, even if `spec` changes
  // afterwards (e.g., fresh block data arriving after the initial render, or
  // parent state updates). That leaves the board rendering stale geometry.
  // Key the board on a hash of the spec so a spec change unmounts (freeBoard
  // runs) and remounts (initBoard + onBoardReady fire) with the fresh data.
  const specKey = useMemo(() => JSON.stringify(spec), [spec])

  // Render the board at the same aspect ratio as the bounding box so 1 unit
  // on x and 1 unit on y produce the same pixel length — otherwise the
  // container gets stretched by CSS max-width and circles come out as
  // ellipses (~1.2:1 aspect on the default 600×400 canvas).
  const [bbXMin, bbYMax, bbXMax, bbYMin] = boundingBox
  const xRange = Math.abs(bbXMax - bbXMin)
  const yRange = Math.abs(bbYMax - bbYMin)

  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: canvas.width, height: canvas.height })

  const sizePercent = GEOMETRY_SIZE_MAP[displaySize]

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const recompute = () => {
      const size = computeBoardSize({
        xRange,
        yRange,
        availableWidth: container.clientWidth * sizePercent,
        maxWidth: canvas.width,
        maxHeight: canvas.height,
        minWidth: Math.min(200, canvas.width),
        minHeight: Math.min(200, canvas.height),
      })
      setDimensions(size)
    }
    recompute()
    const observer = new ResizeObserver(recompute)
    observer.observe(container)
    return () => observer.disconnect()
  }, [xRange, yRange, canvas.width, canvas.height, sizePercent])

  return (
    <div className="my-4 flex justify-center" ref={containerRef}>
      <JSXGraphBoard
        key={specKey}
        id={blockId}
        width={dimensions.width}
        height={dimensions.height}
        boundingBox={boundingBox}
        showGrid={canvas.grid ?? false}
        showAxis={canvas.axis ?? false}
        onBoardReady={handleBoardReady}
        className="border-border"
      />
    </div>
  )
}
