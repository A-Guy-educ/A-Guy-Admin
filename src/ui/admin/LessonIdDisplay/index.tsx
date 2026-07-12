'use client'

import { useDocumentInfo } from '@payloadcms/ui'

export const LessonIdDisplay = () => {
  const { id } = useDocumentInfo()
  const value = id === undefined || id === null ? 'Available after first save' : String(id)

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="lesson-id-display" className="text-label text-foreground">
        Lesson ID
      </label>
      <input
        id="lesson-id-display"
        type="text"
        value={value}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
        className="w-full rounded-md border border-border bg-form px-3 py-2 font-mono text-body-sm text-foreground transition-colors duration-fast"
      />
    </div>
  )
}

export default LessonIdDisplay
