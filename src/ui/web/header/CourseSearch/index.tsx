'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { SearchIcon, X, BookOpen, FileText, HelpCircle, GraduationCap, ChevronRight, Lock } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/infra/utils/ui'
import { SystemLink } from '@/infra/loading/components/SystemLink'
import { useTranslations } from '@/ui/web/providers/I18n'
import { useCourseSearch, useCourseSlug } from '@/client/hooks/useCourseSearch'

interface CourseSearchProps {
  variant: 'desktop' | 'mobile'
  onNavigate?: () => void
}

export const CourseSearch: React.FC<CourseSearchProps> = ({ variant, onNavigate }) => {
  const pathname = usePathname()
  const courseSlug = useCourseSlug(pathname)
  const t = useTranslations('common.courseSearch')

  const [isExpanded, setIsExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { results, isLoading, enrolled, error } = useCourseSearch(query, courseSlug)

  const showDropdown =
    isExpanded &&
    query.length >= 2 &&
    (isLoading || results !== null || enrolled === false || error)

  // Global keyboard shortcut (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setIsExpanded(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Close on click outside (desktop only)
  useEffect(() => {
    if (variant !== 'desktop' || !isExpanded) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsExpanded(false)
        setQuery('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isExpanded, variant])

  // Close on Escape
  useEffect(() => {
    if (!isExpanded) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpanded(false)
        setQuery('')
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isExpanded])

  // Focus input when expanded
  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isExpanded])

  // Close on route change
  useEffect(() => {
    setIsExpanded(false)
    setQuery('')
  }, [pathname])

  const handleResultClick = useCallback(() => {
    setIsExpanded(false)
    setQuery('')
    onNavigate?.()
  }, [onNavigate])

  // Desktop: expandable search
  if (variant === 'desktop') {
    return (
      <div ref={containerRef} className="relative">
        <AnimatePresence mode="wait">
          {!isExpanded ? (
            <motion.button
              key="trigger"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setIsExpanded(true)}
              className="flex items-center p-2 rounded-lg hover:bg-hover transition-all duration-normal"
              aria-label="Search"
            >
              <SearchIcon className="w-5" />
              <kbd className="hidden xl:inline-flex items-center gap-0.5 ms-2 px-1.5 py-0.5 rounded border border-border bg-muted text-[10px] text-muted-foreground font-mono">
                ⌘K
              </kbd>
            </motion.button>
          ) : (
            <motion.div
              key="input"
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-content-gap-xs overflow-hidden"
            >
              <div className="relative">
                <SearchIcon className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  ref={inputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('placeholder')}
                  className="h-9 w-72 rounded-xl border border-border bg-muted/50 ps-9 pe-8 text-body-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={() => {
                    setIsExpanded(false)
                    setQuery('')
                  }}
                  className="absolute end-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted transition-all duration-normal"
                  aria-label="Close search"
                >
                  <X className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dropdown */}
        <AnimatePresence>
          {showDropdown && (
            <SearchDropdown
              results={results}
              isLoading={isLoading}
              enrolled={enrolled}
              error={error}
              t={t}
              onResultClick={handleResultClick}
            />
          )}
        </AnimatePresence>
      </div>
    )
  }

  // Mobile: always show input
  return (
    <div ref={containerRef} className="relative px-6 py-section-xs border-b border-border">
      <div className="relative">
        <SearchIcon className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('placeholder')}
          className="h-10 w-full rounded-xl border border-border bg-muted/50 ps-9 pe-3 text-body-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {showDropdown && (
          <SearchDropdown
            results={results}
            isLoading={isLoading}
            enrolled={enrolled}
            error={error}
            t={t}
            onResultClick={handleResultClick}
            mobile
          />
        )}
      </AnimatePresence>
    </div>
  )
}

interface SearchDropdownProps {
  results: {
    courses?: Array<{ id: string; title: string; url: string }>
    lessons: Array<{ id: string; title: string; type: string; url: string }>
    exercises: Array<{ id: string; title: string; lessonTitle: string; url: string }>
    questions: Array<{ id: string; promptSnippet: string; exerciseTitle: string; url: string }>
  } | null
  isLoading: boolean
  enrolled: boolean | null
  error: string | null
  t: (key: string) => string
  onResultClick: () => void
  mobile?: boolean
}

const SearchDropdown: React.FC<SearchDropdownProps> = ({
  results,
  isLoading,
  enrolled,
  error,
  t,
  onResultClick,
  mobile,
}) => {
  const hasResults =
    results &&
    ((results.courses?.length ?? 0) > 0 ||
      results.lessons.length > 0 ||
      results.exercises.length > 0 ||
      results.questions.length > 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -8, scale: 0.98 }}
      transition={{ duration: 0.15 }}
      className={cn(
        'rounded-lg border border-border bg-card/95 backdrop-blur-xl shadow-modal z-dropdown max-h-80 overflow-y-auto',
        mobile ? 'mt-2 w-full' : 'absolute top-full end-0 mt-2 w-80',
      )}
    >
      {/* Loading skeleton */}
      {isLoading && (
        <div className="p-3 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 animate-pulse">
              <div className="w-1 h-8 rounded-full bg-muted" />
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 bg-muted rounded-md w-3/4" />
                <div className="h-2.5 bg-muted/60 rounded-md w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Not enrolled */}
      {!isLoading && enrolled === false && (
        <div className="p-card-padding-sm text-center">
          <Lock className="w-8 h-8 text-warning mx-auto mb-2 opacity-60" />
          <p className="text-body-sm font-medium text-warning">
            {t('enrollRequired')}
          </p>
          <p className="text-body-xs text-muted-foreground mt-1">
            {t('enrollRequiredHint')}
          </p>
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <div className="p-card-padding-sm text-center text-body-sm text-destructive">
          {t('error')}
        </div>
      )}

      {/* Results */}
      {!isLoading && enrolled === true && results && (
        <>
          {!hasResults && (
            <div className="p-card-padding-sm text-center">
              <SearchIcon className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-body-sm text-muted-foreground">
                {t('noResults')}
              </p>
            </div>
          )}

          {/* Courses */}
          {results.courses && results.courses.length > 0 && (
            <SearchSection icon={GraduationCap} title={t('courses')}>
              {results.courses.map((course) => (
                <SearchResultItem
                  key={course.id}
                  href={course.url}
                  title={course.title}
                  subtitle=""
                  dotColor="bg-primary"
                  onClick={onResultClick}
                />
              ))}
            </SearchSection>
          )}

          {/* Lessons */}
          {results.lessons.length > 0 && (
            <SearchSection icon={BookOpen} title={t('lessons')}>
              {results.lessons.map((lesson) => (
                <SearchResultItem
                  key={lesson.id}
                  href={lesson.url}
                  title={lesson.title}
                  subtitle={lesson.type}
                  dotColor="bg-blue-500"
                  onClick={onResultClick}
                />
              ))}
            </SearchSection>
          )}

          {/* Exercises */}
          {results.exercises.length > 0 && (
            <SearchSection icon={FileText} title={t('exercises')}>
              {results.exercises.map((exercise) => (
                <SearchResultItem
                  key={exercise.id}
                  href={exercise.url}
                  title={exercise.title}
                  subtitle={exercise.lessonTitle}
                  dotColor="bg-green-500"
                  onClick={onResultClick}
                />
              ))}
            </SearchSection>
          )}

          {/* Questions */}
          {results.questions.length > 0 && (
            <SearchSection icon={HelpCircle} title={t('questions')}>
              {results.questions.map((question) => (
                <SearchResultItem
                  key={question.id}
                  href={question.url}
                  title={question.promptSnippet}
                  subtitle={question.exerciseTitle}
                  dotColor="bg-purple-500"
                  onClick={onResultClick}
                />
              ))}
            </SearchSection>
          )}
        </>
      )}
    </motion.div>
  )
}

interface SearchSectionProps {
  icon: React.FC<{ className?: string }>
  title: string
  children: React.ReactNode
}

const SearchSection: React.FC<SearchSectionProps> = ({ icon: Icon, title, children }) => (
  <div className="border-b border-border last:border-b-0">
    <div className="flex items-center gap-content-gap-xs px-3 py-2 bg-muted/30">
      <Icon className="w-3.5 h-3.5 text-muted-foreground" />
      <span className="text-body-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </span>
    </div>
    <div className="py-0.5">{children}</div>
  </div>
)

interface SearchResultItemProps {
  href: string
  title: string
  subtitle: string
  dotColor: string
  onClick: () => void
}

const SearchResultItem: React.FC<SearchResultItemProps> = ({ href, title, subtitle, dotColor, onClick }) => (
  <SystemLink
    href={href}
    onClick={onClick}
    className="group flex items-center gap-2.5 px-3 py-2 mx-1 rounded-md hover:bg-muted transition-all duration-normal"
  >
    <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', dotColor)} />
    <div className="flex-1 min-w-0">
      <p className="text-body-sm text-foreground truncate">{title}</p>
      {subtitle && <p className="text-body-xs text-muted-foreground truncate">{subtitle}</p>}
    </div>
    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-normal flex-shrink-0" />
  </SystemLink>
)
