/**
 * @fileType utility
 * @domain ui
 * @pattern remark-plugin
 * @ai-summary Remark plugin that transforms ::token{text} inline directives into spans.
 *
 * Supported token categories:
 *   - text-highlight-1 .. text-highlight-8 (legacy 8-color palette)
 *   - text-wine-red, text-blue, text-green, text-dark-orange (4-color toolbar palette)
 *   - text-size-small, text-size-normal, text-size-large, text-size-xlarge (font sizes)
 *   - text-align-right (RTL/right alignment for Hebrew-friendly content)
 *
 * All directives follow the syntax ::token{content} where the opening marker and
 * the FIRST closing brace must exist within the same text node. Content with
 * braces is truncated at the first closing brace (same behavior as before).
 */

import { visit } from 'unist-util-visit'

interface Node {
  type: string
  data?: Record<string, unknown>
}

interface Parent extends Node {
  children: Node[]
}

interface Text extends Node {
  type: 'text'
  value: string
}

interface BaseSpan extends Parent {
  type: 'inlineSpan'
  children: (Text | BaseSpan)[]
  data: {
    hName: 'span'
    hProperties: {
      className: string[]
    }
  }
}

interface AlignSpan extends Parent {
  type: 'inlineSpan'
  children: (Text | BaseSpan)[]
  data: {
    hName: 'div'
    hProperties: {
      className: string[]
    }
  }
}

interface Root extends Parent {
  type: 'root'
  children: Node[]
}

/**
 * Whitelisted directive tokens. Tokens are grouped by category so that the
 * renderer can produce the correct output element/class:
 *   - color: text-highlight-1..8 (legacy) and the four named palette colors
 *   - size:  text-size-{small,normal,large,xlarge}
 *   - align: text-align-right (emits a block-level div)
 */
const COLOR_TOKENS = [
  'text-highlight-1',
  'text-highlight-2',
  'text-highlight-3',
  'text-highlight-4',
  'text-highlight-5',
  'text-highlight-6',
  'text-highlight-7',
  'text-highlight-8',
  'text-wine-red',
  'text-blue',
  'text-green',
  'text-dark-orange',
] as const

const SIZE_TOKENS = [
  'text-size-small',
  'text-size-normal',
  'text-size-large',
  'text-size-xlarge',
] as const

const ALIGN_TOKENS = ['text-align-right'] as const

type ColorToken = (typeof COLOR_TOKENS)[number]
type SizeToken = (typeof SIZE_TOKENS)[number]
type AlignToken = (typeof ALIGN_TOKENS)[number]
type AllowedToken = ColorToken | SizeToken | AlignToken

const ALL_TOKENS: readonly AllowedToken[] = [...COLOR_TOKENS, ...SIZE_TOKENS, ...ALIGN_TOKENS]

const TOKEN_PATTERN =
  /::(text-(?:highlight-[1-8]|wine-red|blue|green|dark-orange|size-(?:small|normal|large|xlarge)|align-right))\{/

function isAllowedToken(token: string): token is AllowedToken {
  return (ALL_TOKENS as readonly string[]).includes(token)
}

function isColorToken(token: AllowedToken): token is ColorToken {
  return (COLOR_TOKENS as readonly AllowedToken[]).includes(token)
}

function isSizeToken(token: AllowedToken): token is SizeToken {
  return (SIZE_TOKENS as readonly AllowedToken[]).includes(token)
}

function isAlignToken(token: AllowedToken): token is AlignToken {
  return (ALIGN_TOKENS as readonly AllowedToken[]).includes(token)
}

/**
 * Transform ::token{...} inline directives into spans (color, size) or a
 * block-level div (align).
 *
 * IMPORTANT: Only transforms when the opening marker and the FIRST closing
 * brace are in the SAME text node. Cross-node markers (created by markdown
 * parsing for bold/italic/code/link) are left as literal text.
 */
export function remarkColorSyntax() {
  return (tree: Root) => {
    const transformer = (node: Parent) => {
      node.children = transformChildren(node.children)
    }

    visit(tree, 'paragraph', transformer)
    visit(tree, 'heading', transformer)
    visit(tree, 'listItem', transformer)
  }
}

function buildColorNode(token: ColorToken, content: Text): BaseSpan {
  return {
    type: 'inlineSpan',
    children: [content],
    data: {
      hName: 'span',
      hProperties: {
        className: [`aguy-${token}`],
      },
    },
  }
}

function buildSizeNode(token: SizeToken, content: Text): BaseSpan {
  return {
    type: 'inlineSpan',
    children: [content],
    data: {
      hName: 'span',
      hProperties: {
        className: [`aguy-${token}`],
      },
    },
  }
}

function buildAlignNode(token: AlignToken, content: Text): AlignSpan {
  return {
    type: 'inlineSpan',
    children: [content],
    data: {
      hName: 'div',
      hProperties: {
        className: [`aguy-${token}`],
      },
    },
  }
}

function transformChildren(children: Node[]): Node[] {
  const result: Node[] = []

  for (const node of children) {
    if (node.type !== 'text') {
      result.push(node)
      continue
    }

    const textNode = node as Text
    const text = textNode.value

    const markerMatch = text.match(TOKEN_PATTERN)
    if (!markerMatch) {
      result.push(node)
      continue
    }

    const token = markerMatch[1]
    const markerIndex = markerMatch.index!
    const markerEnd = markerIndex + markerMatch[0].length

    if (!isAllowedToken(token)) {
      result.push(node)
      continue
    }

    const textAfterMarker = text.substring(markerEnd)
    const closingIndex = textAfterMarker.indexOf('}')

    if (closingIndex === -1) {
      result.push(node)
      continue
    }

    if (markerIndex > 0) {
      result.push({
        type: 'text',
        value: text.substring(0, markerIndex),
      } as Text)
    }

    const content = textAfterMarker.substring(0, closingIndex)
    const contentNode: Text = { type: 'text', value: content }

    if (isColorToken(token)) {
      result.push(buildColorNode(token, contentNode) as Node)
    } else if (isSizeToken(token)) {
      result.push(buildSizeNode(token, contentNode) as Node)
    } else if (isAlignToken(token)) {
      result.push(buildAlignNode(token, contentNode) as Node)
    }

    const textAfterClosing = textAfterMarker.substring(closingIndex + 1)
    if (textAfterClosing) {
      const remainingNodes = transformChildren([{ type: 'text', value: textAfterClosing } as Text])
      result.push(...remainingNodes)
    }
  }

  return result
}
