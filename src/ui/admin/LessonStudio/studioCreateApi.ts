'use client'

interface CreateResponse {
  id: string
  title: string
}

async function postCreate(url: string, title: string): Promise<CreateResponse> {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error || `Create failed: ${res.status}`)
  }
  return (await res.json()) as CreateResponse
}

/** Create a new exercise under a lesson. Server auto-fills chapter/course/tenant. */
export function createExerciseUnderLesson(
  lessonId: string,
  title: string,
): Promise<CreateResponse> {
  return postCreate(`/api/studio/lessons/${lessonId}/exercises`, title)
}

/** Create a new section under an exercise. Server auto-fills lesson/chapter/course/tenant. */
export function createSectionUnderExercise(
  exerciseId: string,
  title: string,
): Promise<CreateResponse> {
  return postCreate(`/api/studio/exercises/${exerciseId}/sections`, title)
}
