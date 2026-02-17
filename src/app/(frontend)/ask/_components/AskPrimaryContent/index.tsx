'use client'

import { useTranslations } from '@/ui/web/providers/I18n'
import { PlusCircle } from 'lucide-react'
import { useRef, useState } from 'react'
import type { ExerciseFile } from '../ask-types'
import { AskExerciseCard } from '../AskExerciseCard'

const PLACEHOLDER_EXERCISE: ExerciseFile = {
  id: 1,
  title: 'תרגיל 1 - פונקציות',
  url: 'https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&q=80&w=1200',
  date: new Date().toLocaleDateString('he-IL'),
}

export function AskPrimaryContent() {
  const t = useTranslations('homepage.ask')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<ExerciseFile[]>([PLACEHOLDER_EXERCISE])

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (ev) => {
      const newFile: ExerciseFile = {
        id: Date.now(),
        title: file.name.replace(/\.[^/.]+$/, ''),
        url: ev.target?.result as string,
        date: new Date().toLocaleDateString('he-IL'),
      }
      setFiles((prev) => [newFile, ...prev])
    }
    reader.readAsDataURL(file)

    // Reset input so same file can be re-uploaded
    e.target.value = ''
  }

  return (
    <div className="h-full overflow-y-auto p-6 md:p-10">
      <div className="max-w-2xl mx-auto">
        <header className="mb-10 text-center md:text-right">
          <h1 className="text-4xl font-black mb-2">{t('pageTitle')}</h1>
          <p className="text-muted-foreground">{t('pageSubtitle')}</p>
        </header>

        <div className="flex justify-center mb-10">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-3 px-8 py-4 rounded-2xl font-black bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-lg hover:-translate-y-0.5 group"
          >
            <PlusCircle className="w-6 h-6 group-hover:rotate-90 transition-transform duration-300" />
            <span>{t('uploadButton')}</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept="image/*"
            className="hidden"
          />
        </div>

        <div className="space-y-2">
          {files.map((f) => (
            <AskExerciseCard key={f.id} file={f} />
          ))}
        </div>
      </div>
    </div>
  )
}
