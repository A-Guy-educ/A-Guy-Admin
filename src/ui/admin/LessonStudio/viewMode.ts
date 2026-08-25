export type StudioViewMode = 'edit' | 'document'

const STORAGE_KEY = 'lessonStudio:viewMode'

/**
 * Reads the admin's last-used view mode from localStorage. Returns `null` when
 * nothing is stored, the stored value is invalid, or localStorage is
 * unavailable (SSR, disabled cookies, quota errors — all treated as "no
 * preference, use default").
 */
export function readStoredViewMode(): StudioViewMode | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw === 'edit' || raw === 'document' ? raw : null
  } catch {
    return null
  }
}

export function writeStoredViewMode(mode: StudioViewMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Ignore quota / disabled-storage errors — persistence is a nicety, not a
    // requirement. The in-memory state still reflects the user's choice for
    // the current session.
  }
}
