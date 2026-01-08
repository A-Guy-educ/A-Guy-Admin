# Spec: Chat Context + Long-Term Memory (Payload + MongoDB Atlas Vector Search)

## 1) Goal
Upgrade the current “stored chat history” into a reliable **context + memory system** for the model:
- **Short-term continuity** inside a conversation (working context)
- **Compression** of older turns (running summary)
- **Long-term memory** per **userId**, optionally scoped by **conversationId**, retrieved via **MongoDB Atlas $vectorSearch**
- **Deterministic prompt composition** (same order, same budgets, predictable behavior)
- **Payload remains the single source of truth** for messages

## 2) Non-Goals
- No agentic workflows orchestration (LangGraph) in this iteration
- No UI redesign required (admin UI changes optional)
- No automatic “memory of everything” (we explicitly avoid storing noise)

## 3) Current State (as-is)
You have:
- `conversations` collection
- `messages` stored as an **array** inside each conversation (maxRows=100)
- `lastMessageAt` updated via hook

Limitation:
- The model has no “memory” unless we **inject** context at inference time.
- With `maxRows=100`, old context gets truncated unless we compress it.

## 4) Target Architecture (to-be)
We will implement three layers:

### 4.1 Working Context (Short-Term)
- Always include:
  - System instructions
  - Conversation running summary (if exists)
  - Last N messages from the conversation (window)

### 4.2 Running Summary (Compression)
- A single rolling text summary stored on the conversation.
- Updated periodically (threshold-based) to prevent context loss.

### 4.3 Long-Term Memory (Selective Recall)
- New collection: `memory_items`
- Memory is stored per **userId** and optionally by **conversationId**.
- For each user query, we retrieve top-k relevant memory items using **$vectorSearch**.
- Retrieved memory is injected into the prompt before the recent message window.

## 5) Data Model Changes (Payload)

### 5.1 Conversations (extend existing)
Add fields to `conversations`:

1) `summary` (textarea / rich text plain)
- Purpose: compressed state of older messages
- Default: empty string

2) `summaryUpdatedAt` (date)
- Purpose: observability + debugging
- Default: null

3) `summaryUntil` (group)
Choose ONE of these approaches (pick based on ease):
- **Option A: index-based**
  `summaryUntilMessageIndex` (number)
  Meaning: summary includes messages[0..index]
- **Option B: time-based**
  `summaryUntilTimestamp` (date)
  Meaning: summary includes all messages <= timestamp

Recommendation: **Option B** (time-based) because your messages already have `timestamp`.

4) `contextPolicyVersion` (text or number)
- Purpose: future-proof prompt composition changes
- Default: "v1"

No breaking changes to the existing `messages[]` in this phase.

### 5.2 MemoryItems (new collection)
Create `memory_items` collection:

Required fields:
- `user` (relationship to `users`, required, indexed)
- `conversation` (relationship to `conversations`, optional, indexed)
- `type` (select, required)
  - Allowed: `preference`, `decision`, `fact`, `open_loop`, `profile`, `constraint`, `other`
- `text` (textarea, required, maxLength e.g. 2000)
- `embedding` (json / array of numbers, required)
  - Must be a flat numeric array: length = `numDimensions` of your embeddings model (1536)
- `importance` (number)
  - Recommended scale: 1–5
- `status` (select)
  - `active`, `deprecated`
- `source` (group)
  - `sourceConversationId` (text) or relationship
  - `sourceMessageTimestamp` (date)
  - `sourceMessageRole` (select: user/model)
- `updatedAt` (auto), `createdAt` (auto)

Indexes:
- `user` index
- `conversation` index (optional)
- (Optional) compound index user+conversation for faster filtering

Access Control:
- Same “owner or admin” rule style:
  - Admin: full access
  - User: read only their own memory items; create/update by server only (recommended)

## 6) Atlas Configuration (Automated via Deployment Script)

### 6.1 Principle
Vector Search index MUST be provisioned automatically as part of deployment / environment setup (IaC mindset).
No index creation is allowed during normal user request handling.

### 6.2 Provisioning Strategy
Use ONE of the following (pick one and stick to it):

**Option A (Recommended): Atlas Admin API**
- A dedicated deployment script provisions the Vector Search index on the `memory_items` collection.
- Script is idempotent:
  - If index exists and matches expected definition → no-op
  - If missing → create
  - If exists but differs → fail hard (require manual decision), to avoid accidental destructive changes.

**Option B: DB-side command tooling**
- Use mongosh/driver capabilities to create search index if supported in your environment.
- Same idempotency rules as above.

Recommendation: Option A (Atlas Admin API) for consistent multi-env provisioning.

### 6.3 Required Secrets / Permissions (Deployment Only)
Deployment environment MUST provide:
- Atlas Project ID
- Cluster name (if required by API)
- Database name
- Collection name: `memory_items`
- Vector index name (e.g. `memory_items_embedding_v1`)
- Atlas API credentials (API Key / Service Account)
- Principle of least privilege:
  - Only allow index management; do NOT reuse app runtime DB credentials.

### 6.4 Index Definition (Source of Truth)
The application repository contains a versioned index definition file, e.g.:
- `infra/atlas/vector-index.memory_items.v1.json`

It includes:
- `path`: `embedding`
- `numDimensions`: 1536
- `similarity`: `cosine`
- filterable fields:
  - `user` (required)
  - `conversation` (optional)
  - `status` (recommended)

### 6.5 Provisioning Flow (Idempotent)
On deploy (CI/CD step) run:
1) Validate required env vars exist
2) Fetch current search indexes on `memory_items`
3) If index missing:
   - Create index with the exact definition
   - Poll until index is READY (or until timeout)
4) If index exists:
   - Compare “expected definition hash” vs “current definition hash”
   - If match → success
   - If mismatch → FAIL with explicit diff instructions (manual intervention)

### 6.6 Failure Behavior
- If provisioning fails → deployment fails
- App should still be able to run with memory retrieval feature flag OFF, but:
  - In production we require index provisioning success before enabling the feature flag.

---

## 7) Runtime Contracts

## 7.1 Prompt Composition Contract (MUST be deterministic)
For every model call:

1) System message (static)
2) Conversation summary (if non-empty)
3) Retrieved memory items (Top-K)
4) Recent messages window (last N messages)
5) The new user message (the one being answered)

Order is non-negotiable. No ad-hoc insertions.

### Default values (Policy v1)
- Recent window N: **20**
- Memory Top-K: **8**
- Vector candidates: **100–200** (tune later)
- Summary update threshold: when messages length exceeds **40**
- After summarization, keep last **20** messages in array

## 7.2 “Single Source of Truth” rule
- Payload `conversations.messages[]` is the source of truth for message history.
- We do NOT store message history inside LangChain stores.
- MemoryItems is separate and derived.

## 8) Core Flows

### 8.1 Persist Turn Flow
When a user sends a message:
1) Append `{ role: 'user', content, timestamp }` into conversation.messages
2) Update `lastMessageAt`
3) Call `buildContextAndRunModel()`
4) Append model reply as `{ role: 'model', content, timestamp }`
5) Update `lastMessageAt`

### 8.2 buildContextAndRunModel()
Inputs:
- `conversationId`
- `userId`
- `newUserMessage`

Steps:
1) Load conversation (summary + messages)
2) Compose query for memory retrieval (use newUserMessage + optionally last 1–2 user turns)
3) Retrieve memory items via $vectorSearch:
   - Filter by `userId` ALWAYS
   - Optionally filter by `conversationId` if you want local memory preference
4) Compose prompt (System → Summary → Memory → Recent → New msg)
5) Call model
6) Return model reply

### 8.3 Running Summary Maintenance
Trigger conditions:
- If `messages.length > 40` (threshold)
- Or if conversation is close to maxRows=100

Process:
1) Identify “older segment” to summarize:
   - Everything except last 20 messages
2) Generate a new summary by prompting the model:
   - Input: existing `summary` + the old segment messages
   - Output: updated `summary` (concise, factual, includes decisions + open loops)
3) Persist:
   - Save updated `summary`
   - Update `summaryUpdatedAt`
   - Update `summaryUntilTimestamp` to the last timestamp included in summarized segment
4) Trim:
   - Replace `messages` array with only the last 20 messages

Outcome:
- Conversation never “forgets” old context; it’s compressed into summary.

### 8.4 Memory Extraction (Create/Update MemoryItems)
Trigger conditions:
- After model reply (recommended)
- Or when specific “stable” signals occur (preferences, decisions, constraints)

Extraction method:
1) Provide the model with:
   - The last X messages (small window)
   - Current summary (optional)
2) Ask it to output **candidate memory items**:
   - Each item: { type, text, importance, scope: user|conversation, reason }
3) Server applies filters:
   - Reject low-value items (generic, ephemeral, redundant)
   - Enforce max text length
4) Compute embeddings for accepted items
5) Upsert into `memory_items`:
   - If very similar to an existing memory (by vector search or by normalization hash), update it
   - Else insert new

Dedup policy:
- Prefer updating an existing memory item rather than creating duplicates.

## 9) MongoDB Atlas Vector Retrieval (Implementation Rules)
Query shape (conceptual):
- Use aggregation pipeline with `$vectorSearch` as the FIRST stage.
- Provide:
  - `index`: name of the vector index
  - `path`: "embedding"
  - `queryVector`: embedding(queryText)
  - `numCandidates`
  - `limit` = Top-K (e.g., 8)
  - `filter`: { user: userId, status: 'active', ...(optional conversation) }

Hard requirement:
- Filter by `userId` always to prevent cross-user leakage.

## 10) Security & Guardrails

### 10.1 Tenant Isolation (Critical)
- Every memory retrieval MUST filter by userId.
- Every conversation access follows isOwner/admin.

### 10.2 Data Minimization
- MemoryItems store only what helps product behavior.
- Avoid storing sensitive personal data unless product needs it.

### 10.3 Memory Quality Controls
- Types allowed only from a small enum.
- Importance must be bounded (1–5).
- Use `status=deprecated` rather than delete (auditability).

## 11) Observability & Debugging
Add optional logging per model call:
- conversationId, userId
- prompt policy version
- token budgets (estimated)
- memory items selected (IDs only)
- summary length, recent window size
- model response latency

Store a “context snapshot” optionally (for internal debugging only):
- Keep it off by default, or sample 1% of calls.

## 12) Scaling Considerations

### 12.1 Today (minimal)
- Keep messages embedded in conversation with trimming + summary.
- Memory in separate collection with vector search.

### 12.2 Later (when needed)
- Move messages to a separate `messages` collection for unlimited history + analytics.
- Keep summary on conversation regardless (still useful).
- Keep memory_items as is.

## 13) Acceptance Criteria

### Context Behavior
- The model references facts from earlier in the conversation even after messages are trimmed (via summary).
- The model recalls stable user preferences across conversations (via memory_items on userId).

### Isolation
- No memory item from another user can ever appear in retrieved context (verified via tests).

### Performance
- Vector search retrieval returns within acceptable latency (define SLA target internally).
- Summary updates happen only at threshold events (not every message).

### Data Integrity
- Conversation.messages remains the canonical log of current window.
- summaryUntilTimestamp correctly reflects what was summarized.

## 14) Rollout Plan
1) Add new fields to conversations
2) Create memory_items collection
3) Create Atlas vector index on memory_items
4) Deploy with memory retrieval disabled (feature flag)
5) Enable summary maintenance
6) Enable memory extraction + vector retrieval
7) Monitor logs for:
   - memory retrieval quality
   - token usage
   - latency
   - leakage checks

## 15) Open Configuration Values (must be set once)
- Embeddings model + its `numDimensions` (1536)
- Vector index name
- `N_recent=20`, `K_memory=8`, `threshold=40` (start values)
- Similarity metric: cosine

