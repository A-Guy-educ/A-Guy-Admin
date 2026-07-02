import type { Block } from 'payload'

import { blockSpacingField } from '../../fields/blockSpacing'
import { validateHtml } from './validate-html'

export const HtmlBlock: Block = {
  slug: 'html',
  interfaceName: 'HtmlBlock',
  labels: {
    plural: 'HTML Blocks',
    singular: 'HTML Block',
  },
  fields: [
    {
      name: 'html',
      type: 'code',
      required: true,
      admin: {
        description:
          'Paste an HTML fragment or full HTML document. Inline style="" and <style> are allowed. Scripts, iframes, event handlers, and javascript: URLs are blocked.',
        language: 'html',
        components: {
          Field: '@/ui/admin/QuillField#QuillField',
        },
      },
      validate: validateHtml,
    },
    blockSpacingField,
  ],
}
