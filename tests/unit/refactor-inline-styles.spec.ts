import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('Inline style removal refactor', () => {
  describe('TypingAnimation (FR-002, FR-003)', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/ui/shared/primitives/TypingAnimation/index.tsx'),
      'utf-8',
    )

    it('should NOT contain inline fontFamily style', () => {
      expect(source).not.toMatch(/style=\{\{[\s]*fontFamily/)
    })

    it('should import cn from @/infra/utils/ui', () => {
      expect(source).toMatch(/import\s+\{[^}]*cn[^}]*\}\s+from\s+['"]@\/infra\/utils\/ui['"]/)
    })

    it('should use cn() for class composition with font-mono', () => {
      expect(source).toMatch(/cn\(['"]font-mono['"]/)
    })

    it('should still have font-mono Tailwind class', () => {
      expect(source).toMatch(/font-mono/)
    })

    it('should NOT use template literal for className', () => {
      expect(source).not.toMatch(/className=\{`/)
    })
  })
})
