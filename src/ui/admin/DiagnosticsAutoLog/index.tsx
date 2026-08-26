/**
 * @fileType component
 * @domain admin/diagnostics
 * @pattern client-side auto-poll
 * @ai-summary Renders nothing visually. On mount for admin users, polls
 *   `/api/admin/diagnostics/recent-events` every 5s and console.logs any
 *   events newer than the last poll — so admins get live [boot]/[op]/[coll]
 *   timing feedback in the browser DevTools console without opening the
 *   diagnostics endpoint in a separate tab.
 *
 *   Non-admins get a no-op. Uses window._lastDiagTs to avoid re-logging
 *   the same events across polls in the same session.
 */
'use client'

import { useAuth } from '@payloadcms/ui'
import React, { useEffect } from 'react'

interface DiagEvent {
  ts: number
  msg: string
  [key: string]: unknown
}

// Store the last-seen event timestamp on window so React re-mounts don't
// re-flood the console with events we've already printed.
declare global {
  interface Window {
    __lastDiagTs?: number
  }
}

const POLL_INTERVAL_MS = 5000

export const DiagnosticsAutoLog: React.FC = () => {
  const { user } = useAuth()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const isAdmin = user && (user as any).role === 'admin'

  useEffect(() => {
    if (!isAdmin) return

    let cancelled = false

    const poll = async (): Promise<void> => {
      try {
        const res = await fetch('/api/admin/diagnostics/recent-events', {
          credentials: 'include',
          cache: 'no-store',
        })
        if (cancelled || !res.ok) return
        const data = (await res.json()) as { events?: DiagEvent[] }
        const events = data.events ?? []
        const lastSeen = window.__lastDiagTs ?? 0
        const fresh = events.filter((e) => e.ts > lastSeen)
        if (fresh.length === 0) return
        window.__lastDiagTs = events[events.length - 1].ts
        // eslint-disable-next-line no-console
        console.groupCollapsed(`[diag] ${fresh.length} new event(s)`)
        for (const event of fresh) {
          // eslint-disable-next-line no-console
          console.log(event)
        }
        // eslint-disable-next-line no-console
        console.groupEnd()
      } catch {
        // Silent — diagnostics must never break the admin UI.
      }
    }

    // First poll immediately, then every POLL_INTERVAL_MS.
    void poll()
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [isAdmin])

  return null
}

export default DiagnosticsAutoLog
