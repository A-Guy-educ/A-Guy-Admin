export const COLOR_TOKENS = ['text-wine-red', 'text-blue', 'text-green', 'text-dark-orange'] as const

export const SIZE_TOKENS = [
  'text-size-small',
  'text-size-normal',
  'text-size-large',
  'text-size-xlarge',
] as const

export const ALIGN_TOKENS = ['text-align-right'] as const

export type ColorToken = (typeof COLOR_TOKENS)[number]
export type SizeToken = (typeof SIZE_TOKENS)[number]
export type AlignToken = (typeof ALIGN_TOKENS)[number]
export type AllToken = ColorToken | SizeToken | AlignToken

export const ALL_TOKENS: readonly AllToken[] = [...COLOR_TOKENS, ...SIZE_TOKENS, ...ALIGN_TOKENS]

export function classForToken(token: AllToken): string {
  return `aguy-${token}`
}

export function tokenForClass(className: string): AllToken | null {
  if (!className.startsWith('aguy-')) return null
  const candidate = className.slice(5)
  return (ALL_TOKENS as readonly string[]).includes(candidate) ? (candidate as AllToken) : null
}

export function isAlignToken(token: AllToken): token is AlignToken {
  return (ALIGN_TOKENS as readonly string[]).includes(token)
}

export type TokenCategory = 'color' | 'size' | 'align'

export function tokenCategory(token: AllToken): TokenCategory {
  if ((COLOR_TOKENS as readonly string[]).includes(token)) return 'color'
  if ((SIZE_TOKENS as readonly string[]).includes(token)) return 'size'
  return 'align'
}

export function categoryOfElement(el: Element): TokenCategory | null {
  const tokenAttr = el.getAttribute('data-aguy-token')
  if (tokenAttr && (ALL_TOKENS as readonly string[]).includes(tokenAttr)) {
    return tokenCategory(tokenAttr as AllToken)
  }
  const cls = el.getAttribute('class') ?? ''
  for (const c of cls.split(/\s+/)) {
    const token = tokenForClass(c)
    if (token) return tokenCategory(token)
  }
  return null
}
