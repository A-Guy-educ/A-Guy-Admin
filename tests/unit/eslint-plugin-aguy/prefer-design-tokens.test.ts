/**
 * @fileType test
 * @domain eslint | design-system
 * @ai-summary Tests for the prefer-design-tokens ESLint rule
 */

import { describe } from 'vitest'
import { RuleTester } from 'eslint'

const rule = require('../../../eslint-plugin-aguy/rules/prefer-design-tokens.mjs')

const tseslintParser = require('@typescript-eslint/parser')

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parser: tseslintParser,
    parserOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      ecmaFeatures: { jsx: true },
    },
  },
})

describe('prefer-design-tokens ESLint rule', () => {
  ruleTester.run('flags raw text-body-xs className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<div className="text-body-xs">Small text</div>`,
        filename: 'src/ui/shared/MyComponent.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: { token: 'text-body-xs', raw: 'text-body-xs', suggestion: 'text-body-xs' },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw text-body-sm className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<span className="text-body-sm">Label</span>`,
        filename: 'src/ui/shared/FormField.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: { token: 'text-body-sm', raw: 'text-body-sm', suggestion: 'text-body-sm' },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw text-body-md className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<p className="text-body-md">Body</p>`,
        filename: 'src/ui/shared/Paragraph.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: { token: 'text-body-md', raw: 'text-body-md', suggestion: 'text-body-md' },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw text-heading-xl className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<h2 className="text-heading-xl">Heading</h2>`,
        filename: 'src/ui/shared/Heading.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: {
              token: 'text-heading-xl',
              raw: 'text-heading-xl',
              suggestion: 'text-heading-xl or text-heading-lg',
            },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw text-display-xl className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<h1 className="text-display-xl">Title</h1>`,
        filename: 'src/ui/shared/PageTitle.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: {
              token: 'text-display-xl',
              raw: 'text-display-xl',
              suggestion: 'text-heading-xl',
            },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw p-card-padding-sm className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<div className="p-card-padding-sm">Content</div>`,
        filename: 'src/ui/shared/Container.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: {
              token: 'p-card-padding-sm',
              raw: 'p-card-padding-sm',
              suggestion: 'p-card-padding or p-card-padding-sm',
            },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw p-card-padding className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<section className="p-card-padding">Section</section>`,
        filename: 'src/ui/shared/Section.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: { token: 'p-card-padding', raw: 'p-card-padding', suggestion: 'p-card-padding' },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw p-card-padding-lg className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<div className="p-card-padding-lg">Large padding</div>`,
        filename: 'src/ui/shared/BigBox.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: {
              token: 'p-card-padding-lg',
              raw: 'p-card-padding-lg',
              suggestion: 'p-card-padding-lg',
            },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw shadow-elevation-1 className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<div className="shadow-elevation-1">Card</div>`,
        filename: 'src/ui/shared/Card.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: {
              token: 'shadow-elevation-1',
              raw: 'shadow-elevation-1',
              suggestion: 'shadow-elevation-1',
            },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw shadow-elevation-3 className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<div className="shadow-elevation-3">Elevated</div>`,
        filename: 'src/ui/shared/ElevatedBox.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: {
              token: 'shadow-elevation-3',
              raw: 'shadow-elevation-3',
              suggestion: 'shadow-elevation-2 or shadow-card',
            },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw shadow-card className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<div className="shadow-card">Modal</div>`,
        filename: 'src/ui/shared/Modal.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: {
              token: 'shadow-card',
              raw: 'shadow-card',
              suggestion: 'shadow-elevation-3 or shadow-card',
            },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw duration-fast className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<button className="duration-fast">Fast</button>`,
        filename: 'src/ui/shared/Button.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: { token: 'duration-fast', raw: 'duration-fast', suggestion: 'duration-fast' },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags raw duration-normal className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<button className="duration-normal">Normal</button>`,
        filename: 'src/ui/shared/Transition.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: {
              token: 'duration-normal',
              raw: 'duration-normal',
              suggestion: 'duration-normal',
            },
          },
        ],
      },
    ],
  })

  ruleTester.run('accepts design token text-body-sm', rule.default ?? rule, {
    valid: [
      {
        code: `<span className="text-body-sm">Small label</span>`,
        filename: 'src/ui/shared/Label.tsx',
      },
    ],
    invalid: [],
  })

  ruleTester.run('accepts design token p-card-padding', rule.default ?? rule, {
    valid: [
      {
        code: `<div className="p-card-padding">Content</div>`,
        filename: 'src/ui/shared/Box.tsx',
      },
    ],
    invalid: [],
  })

  ruleTester.run('accepts design token shadow-elevation-2', rule.default ?? rule, {
    valid: [
      {
        code: `<div className="shadow-elevation-2">Elevated</div>`,
        filename: 'src/ui/shared/Elevated.tsx',
      },
    ],
    invalid: [],
  })

  // Note: code must be valid JS/JSX syntax even for tests in non-ui/app paths
  // because ESLint parses the code before running the rule (rule returns early).
  ruleTester.run('ignores files outside src/ui/ and src/app/', rule.default ?? rule, {
    valid: [
      {
        // Non-JSX code to avoid parse error; rule returns early for this filename anyway
        code: `export const config = { name: 'test' }`,
        filename: 'src/server/service.ts',
      },
    ],
    invalid: [],
  })

  ruleTester.run('ignores src/lib/ files', rule.default ?? rule, {
    valid: [
      {
        code: `export const helper = () => 'helper'`,
        filename: 'src/lib/utils.ts',
      },
    ],
    invalid: [],
  })

  ruleTester.run('accepts src/app/ files with design tokens', rule.default ?? rule, {
    valid: [
      {
        code: `<div className="p-card-padding text-heading-xl">Styled</div>`,
        filename: 'src/ui/shared/page.tsx',
      },
    ],
    invalid: [],
  })

  ruleTester.run('flags raw gap-content-gap className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<div className="gap-content-gap">Grid</div>`,
        filename: 'src/ui/shared/Grid.tsx',
        errors: [
          {
            messageId: 'preferToken',
            data: {
              token: 'gap-content-gap',
              raw: 'gap-content-gap',
              suggestion: 'gap-content-gap',
            },
          },
        ],
      },
    ],
  })

  ruleTester.run('flags multiple violations in single className', rule.default ?? rule, {
    valid: [],
    invalid: [
      {
        code: `<div className="text-body-sm p-card-padding-sm shadow-elevation-3">Multiple issues</div>`,
        filename: 'src/ui/shared/Alert.tsx',
        // Each token produces an error with its own hydrated message
        errors: [
          {
            messageId: 'preferToken',
            data: { token: 'text-body-sm', raw: 'text-body-sm', suggestion: 'text-body-sm' },
          },
          {
            messageId: 'preferToken',
            data: {
              token: 'p-card-padding-sm',
              raw: 'p-card-padding-sm',
              suggestion: 'p-card-padding or p-card-padding-sm',
            },
          },
          {
            messageId: 'preferToken',
            data: {
              token: 'shadow-elevation-3',
              raw: 'shadow-elevation-3',
              suggestion: 'shadow-elevation-2 or shadow-card',
            },
          },
        ],
      },
    ],
  })

  ruleTester.run('respects disabledSuggestions option', rule.default ?? rule, {
    valid: [
      {
        code: `<span className="text-body-sm">Intentionally raw</span>`,
        filename: 'src/ui/shared/RawText.tsx',
        options: [{ disabledSuggestions: ['text-body-sm'] }],
      },
    ],
    invalid: [],
  })

  ruleTester.run('accepts py-section-* spacing tokens', rule.default ?? rule, {
    valid: [
      {
        code: `<section className="py-section-md">Section</section>`,
        filename: 'src/ui/shared/Section.tsx',
      },
    ],
    invalid: [],
  })
})
