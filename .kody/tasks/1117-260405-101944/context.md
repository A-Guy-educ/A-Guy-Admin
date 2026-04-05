
### taskify (2026-04-05T10:30:30)
{
  "task_type": "bugfix",
  "title": "Fix missing timeouts on fetch calls causing media timeouts",
  "description": "The `getPdfBufferFromUrl` function in `src/infra/blob/vercel-blob-adapter.ts` (line 403) and `readMediaFile` in `src/infra/llm/providers/shared/media-reader.ts` (lines 59, 129) use `fetch()` without timeout configuration. Large video/audio files cause serverless functions to hang indefinitely, resulting in 504 Gateway Timeout errors. Also `fetchText` in `src/infra/pdfjs/template-
...(truncated)

### plan (2026-04-05T10:31:01)
## Plan

### Step 1: Add timeout to `getPdfBufferFromUrl` in vercel-blob-adapter.ts

**File:** `src/infra/blob/vercel-blob-adapter.ts`  
**Change:** Lines 397–411 — wrap the fetch call in `AbortController` with 30s timeout, matching the existing `fetchBuffer` pattern

```typescript
export async function getPdfBufferFromUrl(url: string): Promise<Buffer> {
  if (!isVercelBlobUrl(url)) {
    throw new Error(`Invalid Vercel Blob URL: ${url}`)
  }

  const controller = new AbortController()
  const t
...(truncated)

### build (2026-04-05T10:38:25)
**Done.** All three fetch calls now have timeout protection:

| File | Function | Timeout |
|------|----------|---------|
| `src/infra/blob/vercel-blob-adapter.ts` | `getPdfBufferFromUrl` | 30s |
| `src/infra/llm/providers/shared/media-reader.ts` | blob-only fetch (line 59) | 30s |
| `src/infra/llm/providers/shared/media-reader.ts` | Payload API fetch (line 135) | 30s |
| `src/infra/pdfjs/template-loader.ts` | `fetchText` | 10s |

All use `AbortController` with `setTimeout` — matching the existi
...(truncated)
