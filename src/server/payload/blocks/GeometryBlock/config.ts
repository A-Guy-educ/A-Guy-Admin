import type { Block } from 'payload'

import { blockSpacingField } from '../../fields/blockSpacing'

export const GeometryBlock: Block = {
  slug: 'geometryBlock',
  interfaceName: 'GeometryBlock',
  labels: {
    plural: 'Geometry Blocks',
    singular: 'Geometry Block',
  },
  fields: [
    {
      name: 'spec',
      type: 'textarea',
      required: true,
      admin: {
        components: {
          Field: '@/ui/admin/IntroGeometryField#IntroGeometrySpecField',
        },
      },
    },
    {
      name: 'displaySize',
      type: 'select',
      defaultValue: 'full',
      options: [
        { label: '25%', value: 'small' },
        { label: '50%', value: 'medium' },
        { label: '75%', value: 'large' },
        { label: '100%', value: 'full' },
      ],
    },
    blockSpacingField,
  ],
}
