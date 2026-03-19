'use client'

import React from 'react'
import { AxisRenderer } from '@/ui/web/exerciserenderer/blocks/AxisRenderer'
import type { DisplaySize } from '@/ui/web/exerciserenderer/blocks/AxisRenderer'

import type { GraphBlock as GraphBlockType } from '@/payload-types'
import type { AxisSpecV1 } from '@/infra/contracts/graphics/axis.v1'

type Props = GraphBlockType & {
  className?: string
  disableInnerContainer?: boolean
}

export const GraphBlock: React.FC<Props> = ({ id, spec, displaySize }) => {
  if (!spec || typeof spec !== 'object') return null

  return (
    <div className="flex justify-center">
      <AxisRenderer
        blockId={id ?? 'graph'}
        spec={spec as AxisSpecV1}
        displaySize={(displaySize as DisplaySize) ?? 'full'}
      />
    </div>
  )
}
