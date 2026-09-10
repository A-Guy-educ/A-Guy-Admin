'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

const STORAGE_KEY = 'aguy-admin-content-sidebar-collapsed'
const CONTAINER_SELECTOR = '.document-fields'
const CONTAINER_CLASS = 'document-fields--content-sidebar-collapsed'

function readStoredState(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writeStoredState(collapsed: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  } catch {
    /* storage unavailable — silently ignore */
  }
}

function applyClassToContainer(collapsed: boolean): void {
  if (typeof document === 'undefined') return
  const container = document.querySelector(CONTAINER_SELECTOR)
  if (!container) return
  container.classList.toggle(CONTAINER_CLASS, collapsed)
}

export const SidebarFoldToggle: React.FC = () => {
  const [collapsed, setCollapsed] = useState<boolean>(false)
  const [mounted, setMounted] = useState<boolean>(false)

  useEffect(() => {
    setMounted(true)
    const initial = readStoredState()
    setCollapsed(initial)
    applyClassToContainer(initial)

    // Restore sidebar when navigating away so the class doesn't leak
    // into other collections' edit views.
    return () => {
      applyClassToContainer(false)
    }
  }, [])

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      writeStoredState(next)
      applyClassToContainer(next)
      return next
    })
  }, [])

  const collapseButton = (
    <button
      type="button"
      onClick={toggle}
      aria-label="Hide sidebar"
      title="Hide sidebar"
      className="content-sidebar-toggle content-sidebar-toggle--collapse"
    >
      <span aria-hidden="true">›</span>
      <span>Hide sidebar</span>
    </button>
  )

  const expandButton =
    mounted && collapsed
      ? createPortal(
          <button
            type="button"
            onClick={toggle}
            aria-label="Show sidebar"
            title="Show sidebar"
            className="content-sidebar-toggle content-sidebar-toggle--expand"
          >
            <span aria-hidden="true">‹</span>
          </button>,
          document.body,
        )
      : null

  return (
    <>
      {collapseButton}
      {expandButton}
    </>
  )
}

export default SidebarFoldToggle
