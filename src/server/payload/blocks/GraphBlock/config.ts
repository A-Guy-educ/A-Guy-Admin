import type { Block } from 'payload'

import { blockSpacingField } from '../../fields/blockSpacing'

export const GraphBlock: Block = {
  slug: 'graphBlock',
  interfaceName: 'GraphBlock',
  labels: {
    plural: 'Graph Blocks',
    singular: 'Graph Block',
  },
  fields: [
    {
      name: 'spec',
      type: 'textarea',
      required: true,
      admin: {
        components: {
          Field: '@/ui/admin/IntroGraphField#IntroGraphSpecField',
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
