'use client'

interface CreateResponse {
  id: string
  title?: string
}

/**
 * Parse a Payload REST error response into a user-safe string. Payload
 * uses two shapes depending on the code path:
 *   - Custom endpoints (studio/*): `{ error: string }`
 *   - Built-in REST + validation errors: `{ errors: [{ message, ... }] }`
 * We check both so the same helper works from every call site.
 */
export async function extractPayloadError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as {
    error?: string | { message?: string }
    errors?: { message?: string }[]
  }
  if (typeof data.error === 'string' && data.error) return data.error
  if (data.error && typeof data.error === 'object' && data.error.message) return data.error.message
  if (Array.isArray(data.errors) && data.errors[0]?.message) return data.errors[0].message
  return fallback
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!res.ok) {
    throw new Error(await extractPayloadError(res, `Request failed: ${res.status}`))
  }
  return (await res.json()) as T
}

// ---- CREATE -------------------------------------------------------------

interface CreateSectionOptions {
  title: string
  /**
   * Optional — sibling section id to place the new section immediately after
   * in the parent exercise's `blocks` playlist. Omit to append at the end.
   */
  insertAfter?: string
}

/** Create a new exercise under a lesson. Server auto-fills chapter/course/tenant. */
export function createExerciseUnderLesson(
  lessonId: string,
  options: { title: string; insertAfter?: string },
): Promise<CreateResponse> {
  return postJson<CreateResponse>(`/api/studio/lessons/${lessonId}/exercises`, options)
}

/** Create a new section under an exercise. Server auto-fills lesson/chapter/course/tenant. */
export function createSectionUnderExercise(
  exerciseId: string,
  options: CreateSectionOptions,
): Promise<CreateResponse> {
  return postJson<CreateResponse>(`/api/studio/exercises/${exerciseId}/sections`, options)
}

// ---- DUPLICATE ----------------------------------------------------------

/** Duplicate a section — deep copy + insert right after source in parent playlist. */
export function duplicateSection(sectionId: string): Promise<CreateResponse> {
  return postJson<CreateResponse>(`/api/studio/sections/${sectionId}/duplicate`, {})
}

/**
 * Duplicate an exercise — uses the existing prod deep-clone endpoint
 * (`/api/exercises/:id/duplicate-exercise`, which also clones sections) and
 * then reorders the parent lesson's playlist so the new exercise sits right
 * after the source. Two calls in sequence; if the reorder fails the new
 * exercise still exists but at the end of the list.
 */
export async function duplicateExercise(
  exerciseId: string,
  lessonId: string,
): Promise<{ id: string }> {
  const dupRes = await fetch(`/api/exercises/${exerciseId}/duplicate-exercise`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
  if (!dupRes.ok) {
    throw new Error(await extractPayloadError(dupRes, `Duplicate failed: ${dupRes.status}`))
  }
  const { outputExerciseId } = (await dupRes.json()) as { outputExerciseId: string }
  // Best-effort reorder — if it fails, the new exercise still landed and
  // the admin can just drag it. Not worth throwing here.
  try {
    await postJson(`/api/studio/lessons/${lessonId}/reorder-exercises`, {
      movedExerciseId: outputExerciseId,
      insertAfterExerciseId: exerciseId,
    })
  } catch {
    // ignore
  }
  return { id: outputExerciseId }
}

// ---- DELETE -------------------------------------------------------------
// Payload's built-in DELETE endpoints already fire the collection afterDelete
// hooks that unwire the removed doc from its parent's playlist (see
// `removeBlockFromExercise` / `removeBlockFromLesson`), so the studio just
// calls those directly.

async function deleteCollection(collection: 'sections' | 'exercises', id: string): Promise<void> {
  const res = await fetch(`/api/${collection}/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) {
    throw new Error(await extractPayloadError(res, `Delete failed: ${res.status}`))
  }
}

export function deleteSection(sectionId: string): Promise<void> {
  return deleteCollection('sections', sectionId)
}

export function deleteExercise(exerciseId: string): Promise<void> {
  return deleteCollection('exercises', exerciseId)
}
