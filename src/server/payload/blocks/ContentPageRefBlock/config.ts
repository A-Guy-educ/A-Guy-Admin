import type { Block } from 'payload'

export const ContentPageRefBlock: Block = {
  slug: 'contentPageRef',
  interfaceName: 'ContentPageRefBlock',
  labels: {
    singular: 'Content Page',
    plural: 'Content Pages',
  },
  fields: [
    {
      name: 'contentPage',
      type: 'relationship',
      relationTo: 'content-pages',
      required: true,
      filterOptions: () => {
        return {
          status: { equals: 'published' },
          isActive: { equals: true },
        }
      },
      admin: {
        description: 'Reference to a published content page',
      },
    },
  ],
}
