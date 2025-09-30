import { useCallback, useEffect, useMemo, useState } from 'react'
import { z } from 'zod'

const STORAGE_KEY = 'reader.preferences.v1'

export const readerPreferencesSchema = z
  .object({
    prefetchRadius: z
      .number({ invalid_type_error: 'Prefetch distance must be a number' })
      .int('Prefetch distance must be an integer')
      .min(0, 'Prefetch distance cannot be negative')
      .max(8, 'Prefetch distance is too large'),
    cacheBudgetMb: z
      .number({ invalid_type_error: 'Cache budget must be a number' })
      .int('Cache budget must be an integer')
      .min(128, 'Cache budget must be at least 128MB')
      .max(2048, 'Cache budget must be at most 2048MB'),
    themeDensity: z.enum(['comfortable', 'compact']),
    readingDirection: z.enum(['ltr', 'rtl'])
})
  .readonly()

export type ReaderPreferences = z.infer<typeof readerPreferencesSchema>

export const DEFAULT_PREFERENCES: ReaderPreferences = Object.freeze({
  prefetchRadius: 2,
  cacheBudgetMb: 512,
  themeDensity: 'comfortable',
  readingDirection: 'ltr'
})

function parseStoredPreferences(raw: unknown): ReaderPreferences {
  const input = typeof raw === 'object' && raw !== null ? raw : {}
  const merged = { ...DEFAULT_PREFERENCES, ...input }
  const result = readerPreferencesSchema.safeParse(merged)
  if (result.success) {
    return result.data
  }
  console.warn('[preferences] Failed to parse stored preferences', result.error.format())
  return DEFAULT_PREFERENCES
}

export function loadPreferences(): ReaderPreferences {
  if (typeof window === 'undefined') {
    return DEFAULT_PREFERENCES
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return DEFAULT_PREFERENCES
    }
    const parsed: unknown = JSON.parse(raw)
    return parseStoredPreferences(parsed)
  } catch (error) {
    console.warn('[preferences] Unable to load preferences', error)
    return DEFAULT_PREFERENCES
  }
}

export function savePreferences(preferences: ReaderPreferences) {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  } catch (error) {
    console.warn('[preferences] Unable to persist preferences', error)
  }
}

export function useReaderPreferences() {
  const [preferences, setPreferences] = useState<ReaderPreferences>(() => loadPreferences())

  // Avoid unnecessary re-renders when data stays the same.
  const setValidatedPreferences = useCallback((next: ReaderPreferences) => {
    setPreferences((prev) => {
      if (Object.is(prev, next)) {
        return prev
      }
      return next
    })
  }, [])

  useEffect(() => {
    savePreferences(preferences)
  }, [preferences])

  const update = useCallback(
    (patch: Partial<ReaderPreferences> | ((prev: ReaderPreferences) => ReaderPreferences)) => {
      setPreferences((prev) => {
        const candidate = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch }
        const result = readerPreferencesSchema.safeParse(candidate)
        if (!result.success) {
          console.warn('[preferences] Invalid preference update', result.error.format())
          return prev
        }
        return result.data
      })
    },
    []
  )

  const resolved = useMemo(() => readerPreferencesSchema.parse(preferences), [preferences])

  return { preferences: resolved, setPreferences: setValidatedPreferences, updatePreferences: update }
}
