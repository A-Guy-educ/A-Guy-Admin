import type { Block } from 'payload'

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
      type: 'json',
      required: true,
      admin: {
        description:
          'GeometrySpecV1 JSON. Must have kind:"euclidean", canvas:{width,height}, and elements:{points,lines,circles,angles}.',
      },
    },
  ],
}
