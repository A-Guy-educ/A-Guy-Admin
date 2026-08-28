'use client'

interface CreateResponse {
  id: string
  title?: string
}

/**
 * Parse a Payload REST error response into a user-safe string. Payload uses
 * two shapes depending on the code path — custom endpoints return
 * `{ error: string }` while built-in REST + validation errors return
 * `{ errors: [{ message, ... }] }`. Try both so the caller never sees a
 * bare status code.
 */
async function extractPayloadError(res: Response, fallback: string): Promise<string> {
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
  if (!res.ok) throw new Error(await extractPayloadError(res, `Request failed: ${res.status}`))
  return (await res.json()) as T
}

// ---- CREATE (with optional insertAfter for +Add-between-rows) -----------

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
  options: { title: string; insertAfter?: string },
): Promise<CreateResponse> {
  return postJson<CreateResponse>(`/api/studio/exercises/${exerciseId}/sections`, options)
}

// ---- DUPLICATE (via PR #384's endpoints) --------------------------------

/**
 * Duplicate a section. Uses the studio duplicate endpoint from PR #384
 * which handles deep-copy + block-id regeneration + inserting the copy
 * right after the source in the parent exercise's playlist.
 */
export function duplicateSection(sectionId: string): Promise<CreateResponse> {
  return postJson<CreateResponse>(`/api/studio/sections/${sectionId}/duplicate`, {})
}

/**
 * Duplicate an exercise. Uses the prod deep-clone endpoint (which walks the
 * section graph via `cloneSectionsAndRewireExercises` and regenerates block
 * ids per PR #384), then hits our small `reorder-lesson-exercises` endpoint
 * to snap the new copy back to right after the source (prod endpoint appends
 * at end).
 */
export async function duplicateExercise(
  exerciseId: string,
  lessonId: string,
): Promise<{ id: string; repositioned: boolean }> {
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
  let repositioned = true
  try {
    await postJson(`/api/studio/lessons/${lessonId}/reorder-exercises`, {
      movedExerciseId: outputExerciseId,
      insertAfterExerciseId: exerciseId,
    })
  } catch {
    repositioned = false
  }
  return { id: outputExerciseId, repositioned }
}

// ---- DELETE -------------------------------------------------------------
// Sections use Payload's built-in REST DELETE — the collection's afterDelete
// hook unwires the sectionRef from the parent exercise's playlist for us.
// Exercises use PR #384's cascade-delete endpoint so child sections don't
// get orphaned with dangling FKs.

export async function deleteSection(sectionId: string): Promise<void> {
  const res = await fetch(`/api/sections/${sectionId}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  if (!res.ok) throw new Error(await extractPayloadError(res, `Delete failed: ${res.status}`))
}

export async function deleteExerciseCascade(exerciseId: string): Promise<void> {
  const res = await fetch(
    `/api/cascade-delete?collection=exercises&id=${encodeURIComponent(exerciseId)}`,
    { method: 'DELETE', credentials: 'include' },
  )
  if (!res.ok) throw new Error(await extractPayloadError(res, `Delete failed: ${res.status}`))
}
