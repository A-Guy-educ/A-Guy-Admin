'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import type { GeometrySpecV1 } from '@/infra/contracts'
import { renderGeometrySpec } from '../../graphics/geometryElements'
import { computeBoardSize } from '@/infra/utils/graphics/board-sizing'

const JSXGraphBoard = dynamic(
  () => import('../../graphics/JSXGraphBoard').then((m) => ({ default: m.JSXGraphBoard })),
  {
    ssr: false,
    loading: () => <div className="w-full h-64 bg-muted animate-pulse rounded-lg" />,
  },
)

interface GeometryRendererProps {
  blockId: string
  spec: GeometrySpecV1
}

export function GeometryRenderer({ blockId, spec }: GeometryRendererProps) {
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

  // Render the board at the same aspect ratio as the bounding box so 1 unit
  // on x and 1 unit on y produce the same pixel length — otherwise the
  // container gets stretched by CSS max-width and circles come out as
  // ellipses (~1.2:1 aspect on the default 600×400 canvas).
  const [bbXMin, bbYMax, bbXMax, bbYMin] = boundingBox
  const xRange = Math.abs(bbXMax - bbXMin)
  const yRange = Math.abs(bbYMax - bbYMin)

  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: canvas.width, height: canvas.height })

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const recompute = () => {
      const size = computeBoardSize({
        xRange,
        yRange,
        availableWidth: container.clientWidth,
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
  }, [xRange, yRange, canvas.width, canvas.height])

  return (
    <div className="my-4 flex justify-center" ref={containerRef}>
      <JSXGraphBoard
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
