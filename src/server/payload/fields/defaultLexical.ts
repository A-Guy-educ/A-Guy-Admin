import type { TextFieldSingleValidation } from 'payload'
import {
  AlignFeature,
  BoldFeature,
  FixedToolbarFeature,
  ItalicFeature,
  lexicalEditor,
  LinkFeature,
  ParagraphFeature,
  UnderlineFeature,
  type LinkFields,
} from '@payloadcms/richtext-lexical'

import { EditorTextStateFeature, ViewEditToggleFeature } from './lexicalExtensions'

/**
 * Static list of feature providers used by `defaultLexical`. Exported so that
 * tests, and other callers that need to know which toolbar controls the
 * editor exposes, can inspect it without spinning up a full Payload config.
 *
 * The list is referenced from `defaultLexical` below — keep the order in
 * sync when adding or removing features.
 */
export const defaultLexicalFeatures = [
  ParagraphFeature(),
  UnderlineFeature(),
  BoldFeature(),
  ItalicFeature(),
  LinkFeature({
    enabledCollections: ['pages'],
    fields: ({ defaultFields }) => {
      const defaultFieldsWithoutUrl = defaultFields.filter((field) => {
        if ('name' in field && field.name === 'url') return false
        return true
      })

      return [
        ...defaultFieldsWithoutUrl,
        {
          name: 'url',
          type: 'text',
          admin: {
            condition: (_data, siblingData) => siblingData?.linkType !== 'internal',
          },
          label: ({ t }) => t('fields:enterURL'),
          required: true,
          validate: ((value, options) => {
            if ((options?.siblingData as LinkFields)?.linkType === 'internal') {
              return true // no validation needed, as no url should exist for internal links
            }
            return value ? true : 'URL is required'
          }) as TextFieldSingleValidation,
        },
      ]
    },
  }),
  AlignFeature(),
  FixedToolbarFeature(),
  EditorTextStateFeature(),
  ViewEditToggleFeature(),
]

export const defaultLexical = lexicalEditor({
  features: defaultLexicalFeatures,
})
