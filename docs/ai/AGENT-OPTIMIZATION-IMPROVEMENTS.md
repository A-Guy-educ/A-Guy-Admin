# AI Coding Agent Optimization Improvements

**Purpose**: Improve codebase discoverability, type safety, and pattern recognition for AI coding agents
**Status**: Recommendations (not yet implemented)
**Last Updated**: 2026-01-07

---

## 🎯 Priority 0: Critical Discoverability Issues

### 1. File Metadata Coverage

**Problem**: Only 1 file (`src/lib/ai/smart-doc-loader.ts`) has `@fileType/@domain/@pattern` metadata, but pattern index generator expects it.

**Impact**:
- Pattern discovery fails (agents can't find examples)
- SmartDocLoader can't categorize files
- Pattern index is incomplete

**Solution**: Add metadata headers to all key files:

```typescript
/**
 * @fileType collection-config
 * @domain courses
 * @pattern published-content, hierarchical-data
 * @ai-summary Courses collection with chapters relationship and published state
 */
export const Courses: CollectionConfig = { ... }
```

**Files to update** (estimated 50+ files):
- All collection configs: `src/collections/**/*.ts`
- All components: `src/components/**/*.tsx`
- All endpoints: `src/endpoints/**/*.ts`
- All utilities: `src/lib/**/*.ts`

**Implementation**:
1. Create script to auto-detect and suggest metadata
2. Add ESLint rule to enforce metadata on new files
3. Batch update existing files

**Estimated Impact**:
- Pattern discovery: 0% → 95% coverage
- SmartDocLoader accuracy: +80%

---

### 2. Centralized Type Exports

**Problem**: 176 type/interface exports across 53 files; no central index.

**Impact**:
- Agents must search many files to find types
- Inconsistent imports across codebase
- Type discovery is slow

**Solution**: Create `src/types/index.ts` that re-exports common types:

```typescript
/**
 * Centralized Type Exports
 *
 * All commonly-used types are re-exported here for easy discovery.
 * Use these imports instead of deep imports from individual files.
 */

// Payload types (auto-generated)
export type { User, Course, Exercise, Conversation, MemoryItem } from '@/payload-types'

// Collection configs
export type { CollectionConfig, GlobalConfig } from 'payload'

// AI types
export type {
  AIContext,
  LoadedDocs,
  DocTier,
} from '@/lib/ai/smart-doc-loader'

export type {
  MemoryItem as MemoryItemSearch,
  RetrievalResult,
} from '@/lib/ai/vector-search'

// Component types
export type { ChatMessage } from '@/lib/ai/services/exercise-chat-service'
export type { Theme } from '@/providers/Theme/types'

// Contract types
export type {
  BlockId,
  ColorString,
  PositionEnum,
} from '@/contracts/primitives'

// ... more exports
```

**Implementation**:
1. Audit all type exports
2. Create `src/types/index.ts`
3. Update imports across codebase
4. Document in CLAUDE.md

**Estimated Impact**:
- Type discovery time: -70%
- Import consistency: +90%

---

## 🎯 Priority 1: Quality of Life Improvements

### 3. Standardized Error Messages

**Problem**: Many errors lack context or actionable guidance.

**Impact**:
- Agents struggle to diagnose issues
- Error messages don't guide fixes

**Solution**: Create error factory with context:

```typescript
// src/lib/errors/agent-friendly.ts

interface AgentFriendlyError {
  message: string
  context: {
    file?: string
    function?: string
    suggestion?: string
    relatedDocs?: string[]
  }
}

export function createAgentError(
  message: string,
  context: AgentFriendlyError['context']
): Error {
  const error = new Error(message)
  error.name = 'AgentFriendlyError'
  ;(error as any).context = context
  return error
}

// Usage:
throw createAgentError(
  'Collection must have access control defined',
  {
    file: 'src/collections/MyCollection.ts',
    suggestion: 'Add access: { read: ..., create: ..., update: ..., delete: ... }',
    relatedDocs: ['docs/ai/quick-reference/CHEAT-SHEET.md#collection-patterns']
  }
)
```

**Implementation**:
1. Create error factory
2. Update critical error sites (collections, endpoints)
3. Add error context to validation functions

**Estimated Impact**:
- Error diagnosis time: -50%
- Fix accuracy: +40%

---

### 4. Documentation Integration

**Problem**: SmartDocLoader exists but isn't referenced in main docs.

**Impact**:
- Agents may not discover SmartDocLoader
- Underutilized optimization tool

**Solution**: Add SmartDocLoader usage to entry points:

**Update `CLAUDE.md`**:
```markdown
## AI Agent Tools

### Smart Documentation Loading

Use SmartDocLoader for context-aware docs:

```typescript
import { SmartDocLoader } from '@/lib/ai/smart-doc-loader'

// Creating a collection
const docs = SmartDocLoader.forCollection('create')
console.log(docs.estimatedTokens) // ~380 tokens
```

See [docs/ai/QUICK-START.md](docs/ai/QUICK-START.md) for full guide.
```

**Update `AGENTS.md`** (add section):
```markdown
## AI Agent Optimization

This codebase includes tools to help AI agents work efficiently:

- **SmartDocLoader**: Context-aware documentation loading
- **DocSearch**: Fast keyword-based documentation search
- **Pattern Index**: Pattern → files mapping
- **JSON Schemas**: Machine-readable validation contracts

See [docs/ai/README.md](docs/ai/README.md) for details.
```

**Estimated Impact**:
- SmartDocLoader usage: +200%
- Token efficiency: +30%

---

### 5. Test Pattern Discovery

**Problem**: Testing strategy exists but isn't indexed.

**Impact**:
- Agents may miss testing patterns
- Inconsistent test structure

**Solution**:
1. Add test patterns to pattern index
2. Create quick reference for testing
3. Add test examples to CHEAT-SHEET.md

**Update `docs/ai/quick-reference/CHEAT-SHEET.md`**:
```markdown
## Testing Patterns

### Integration Test Template
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { getPayload } from 'payload'
import config from '@payload-config'

describe('MyCollection', () => {
  let payload: Payload

  beforeAll(async () => {
    payload = await getPayload({ config })
  })

  it('should create with access control', async () => {
    // Test implementation
  })
})
```

### Mocking Strategy
- Mock external APIs (OpenAI) by default
- Use `USE_REAL_OPENAI_API=true` for validation
- See [tests/TESTING_STRATEGY.md](../../tests/TESTING_STRATEGY.md)
```

**Estimated Impact**:
- Test pattern compliance: +60%
- Test generation accuracy: +40%

---

## 🎯 Priority 2: Enhanced Validation & Examples

### 6. Schema Examples

**Problem**: JSON schemas validate but don't include examples.

**Impact**:
- Agents generate code that passes validation but may not match patterns
- No concrete examples to reference

**Solution**: Add `examples` to JSON schemas:

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Collection Config",
  "type": "object",
  "required": ["slug", "access", "fields"],
  "properties": {
    "slug": { "type": "string" },
    "access": { "type": "object" }
  },
  "examples": [
    {
      "slug": "posts",
      "access": {
        "read": "isPublished",
        "create": "isAdmin",
        "update": "isAdmin",
        "delete": "isAdmin"
      },
      "fields": [
        { "name": "title", "type": "text", "required": true }
      ]
    }
  ]
}
```

**Implementation**:
1. Update `docs/ai/schemas/collection-schema.json`
2. Update `docs/ai/schemas/component-schema.json`
3. Update `docs/ai/schemas/endpoint-schema.json`

**Estimated Impact**:
- Code generation accuracy: +25%
- Pattern compliance: +30%

---

### 7. Import Path Consistency

**Problem**: Mixed import styles (`@/` vs relative).

**Impact**:
- Agents may use inconsistent imports
- Code review overhead

**Solution**:
1. Document preferred import style
2. Add ESLint rule
3. Create auto-fix script

**Add to `CLAUDE.md`**:
```markdown
## Import Style

**Always use `@/` aliases** for src imports:

```typescript
// ✅ Correct
import { getPayload } from 'payload'
import { User } from '@/payload-types'
import { SmartDocLoader } from '@/lib/ai/smart-doc-loader'

// ❌ Wrong
import { SmartDocLoader } from '../../../lib/ai/smart-doc-loader'
```

**Exception**: Use relative imports within the same directory:
```typescript
// ✅ Correct (same directory)
import { helper } from './helper'
```
```

**Add ESLint rule**:
```javascript
// eslint.config.mjs
rules: {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['../../*', '../../../*'],
          message: 'Use @/ alias instead of relative imports from src/',
        },
      ],
    },
  ],
}
```

**Estimated Impact**:
- Import consistency: +95%
- Code review time: -20%

---

### 8. Component API Documentation

**Problem**: Components lack JSDoc for props/interfaces.

**Impact**:
- Agents can't infer component APIs
- Must read implementation to understand usage

**Solution**: Add JSDoc to all component props:

```typescript
/**
 * Card Component
 *
 * @fileType component
 * @domain ui
 * @pattern tailwind-component
 * @ai-summary Reusable card component with header, body, and footer sections
 */

export interface CardProps {
  /** Card title displayed in header */
  title: string

  /** Optional card description */
  description?: string

  /** Card content (children) */
  children: React.ReactNode

  /** Optional footer content */
  footer?: React.ReactNode

  /** Additional CSS classes */
  className?: string
}

/**
 * Card component for displaying content in a contained box
 *
 * @example
 * ```tsx
 * <Card title="Hello" description="World">
 *   <p>Content</p>
 * </Card>
 * ```
 */
export function Card({ title, description, children, footer, className }: CardProps) {
  // ...
}
```

**Implementation**:
1. Add JSDoc to shared components first
2. Create template for new components
3. Add ESLint rule to enforce JSDoc on exported components

**Estimated Impact**:
- Component discovery: +70%
- Usage accuracy: +50%

---

## 📊 Implementation Roadmap

### Phase 1: Critical (Week 1-2)
- [ ] Add file metadata to all collections (15 files)
- [ ] Create `src/types/index.ts` with common exports
- [ ] Update CLAUDE.md with SmartDocLoader usage
- [ ] Add test patterns to CHEAT-SHEET.md

### Phase 2: Quality (Week 3-4)
- [ ] Create agent-friendly error factory
- [ ] Add examples to JSON schemas
- [ ] Document import style guidelines
- [ ] Add ESLint rules for consistency

### Phase 3: Enhancement (Week 5-6)
- [ ] Add JSDoc to all shared components
- [ ] Batch update file metadata (components, endpoints)
- [ ] Create auto-fix scripts for imports
- [ ] Generate component API documentation

---

## 📈 Success Metrics

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| File metadata coverage | 2% | 80% | Pattern index scan |
| Type discovery time | ~30s | ~5s | Agent interaction logs |
| Error diagnosis time | ~5min | ~2min | Error resolution logs |
| SmartDocLoader usage | 10% | 60% | Code generation logs |
| Import consistency | 70% | 95% | ESLint rule violations |
| Component JSDoc coverage | 20% | 80% | File scan |

---

## 🔧 Tools & Scripts Needed

### 1. Metadata Auto-Detection Script
```typescript
// scripts/suggest-metadata.ts
// Scans files and suggests @fileType/@domain/@pattern based on content
```

### 2. Type Export Auditor
```typescript
// scripts/audit-type-exports.ts
// Finds all type/interface exports and suggests centralization
```

### 3. Import Path Fixer
```typescript
// scripts/fix-imports.ts
// Converts relative imports to @/ aliases
```

### 4. JSDoc Generator
```typescript
// scripts/generate-jsdoc.ts
// Adds JSDoc to components based on TypeScript types
```

---

## 💡 Quick Wins (Can Do Now)

1. **Add SmartDocLoader to CLAUDE.md** (5 min)
2. **Create `src/types/index.ts` with top 20 types** (30 min)
3. **Add test patterns to CHEAT-SHEET.md** (15 min)
4. **Add examples to collection-schema.json** (20 min)
5. **Document import style in CLAUDE.md** (10 min)

**Total**: ~80 minutes for immediate improvements

---

## 📚 Related Documentation

- [AI Optimization README](./README.md) - Current AI optimization status
- [QUICK-START.md](./QUICK-START.md) - Quick start guide
- [CLAUDE.md](../../CLAUDE.md) - Claude Code reference
- [AGENTS.md](../../AGENTS.md) - Full Payload patterns

---

**Status**: Recommendations ready for implementation
**Next Step**: Prioritize Phase 1 items and create implementation tickets

