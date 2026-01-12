'use client'

import { useState } from 'react'
import { TypingAnimation } from '@/components/shared/TypingAnimation'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { setUserProfile } from '@/lib/localStorage/userProfile'
import { useTranslations } from '@/providers/I18n'

type FlowStep = 'greeting' | 'mood' | 'grade' | 'complete'

const MOODS = ['happy', 'neutral', 'sad', 'excited'] as const
const GRADES = ['7', '8', '9', '10', '11', '12'] as const

export function GreetingFlow({ onComplete }: { onComplete: () => void }) {
  const t = useTranslations('homepage.greeting')
  const [step, setStep] = useState<FlowStep>('greeting')
  const [selectedMood, setSelectedMood] = useState<string>('')

  const handleMoodSelect = (mood: string) => {
    setSelectedMood(mood)
    setStep('grade')
  }

  const handleGradeSelect = (grade: string) => {
    setUserProfile({
      gradeLevel: grade,
      mood: selectedMood,
      lastVisit: new Date().toISOString(),
    })
    setStep('complete')
    setTimeout(() => onComplete(), 1000)
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-4">
      {step === 'greeting' && (
        <div className="max-w-2xl text-center">
          <TypingAnimation
            text={t('welcome')}
            speed={50}
            onComplete={() => setTimeout(() => setStep('mood'), 500)}
            className="text-2xl md:text-4xl mb-8"
          />
        </div>
      )}

      {step === 'mood' && (
        <div className="max-w-md w-full space-y-6">
          <h2 className="text-xl text-center">{t('moodQuestion')}</h2>
          <div className="grid grid-cols-2 gap-4">
            {MOODS.map((mood) => (
              <Button
                key={mood}
                variant="outline"
                size="lg"
                onClick={() => handleMoodSelect(mood)}
                className="h-20"
              >
                {t(`moods.${mood}`)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {step === 'grade' && (
        <div className="max-w-md w-full space-y-6">
          <h2 className="text-xl text-center">{t('gradeQuestion')}</h2>
          <Select onValueChange={handleGradeSelect}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t('selectGrade')} />
            </SelectTrigger>
            <SelectContent>
              {GRADES.map((grade) => (
                <SelectItem key={grade} value={grade}>
                  {t('gradeLabel').replace('{{grade}}', grade)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {step === 'complete' && (
        <div className="text-center">
          <TypingAnimation text={t('letsStart')} speed={50} className="text-2xl" />
        </div>
      )}
    </div>
  )
}
