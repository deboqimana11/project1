import * as React from 'react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { DEFAULT_PREFERENCES, ReaderPreferences } from '@/lib/preferences'
import type { ReaderKeymap } from '@/lib/keymap'
import { KeymapEditor } from './keymap-editor'

const formSchema = z.object({
  prefetchRadius: z.coerce
    .number({ invalid_type_error: 'Prefetch distance must be a number' })
    .int('Prefetch distance must be an integer')
    .min(0, 'Prefetch distance cannot be negative')
    .max(8, 'Prefetch distance is too large'),
  cacheBudgetMb: z.coerce
    .number({ invalid_type_error: 'Cache budget must be a number' })
    .int('Cache budget must be an integer')
    .min(128, 'Cache budget must be at least 128MB')
    .max(2048, 'Cache budget must be at most 2048MB'),
  themeDensity: z.enum(['comfortable', 'compact']),
  readingDirection: z.enum(['ltr', 'rtl'])
})

export type SettingsFormValues = z.infer<typeof formSchema>

interface SettingsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  preferences: ReaderPreferences
  onPreferencesChange: (preferences: ReaderPreferences) => void
  trigger?: React.ReactNode
  keymap: ReaderKeymap
}

export function SettingsSheet({
  open,
  onOpenChange,
  preferences,
  onPreferencesChange,
  trigger,
  keymap
}: SettingsSheetProps) {
  const [formValues, setFormValues] = React.useState<SettingsFormValues>(() => formSchema.parse(DEFAULT_PREFERENCES))

  React.useEffect(() => {
    if (!open) {
      return
    }
    setFormValues(formSchema.parse(preferences))
  }, [open, preferences])

  const commit = React.useCallback(
    (update: (prev: SettingsFormValues) => SettingsFormValues) => {
      setFormValues((prev) => {
        const candidate = update(prev)
        const result = formSchema.safeParse(candidate)
        if (!result.success) {
          console.warn('[settings] rejecting invalid preferences', result.error.flatten())
          return prev
        }
        onPreferencesChange(result.data)
        return result.data
      })
    },
    [onPreferencesChange]
  )

  const handlePrefetchChange = React.useCallback(
    (value: number) => {
      commit((prev) => ({ ...prev, prefetchRadius: value }))
    },
    [commit]
  )

  const handleCacheChange = React.useCallback(
    (value: number) => {
      commit((prev) => ({ ...prev, cacheBudgetMb: value }))
    },
    [commit]
  )

  const handleThemeDensityChange = React.useCallback(
    (value: SettingsFormValues['themeDensity']) => {
      commit((prev) => ({ ...prev, themeDensity: value }))
    },
    [commit]
  )

  const handleReadingDirectionChange = React.useCallback(
    (value: SettingsFormValues['readingDirection']) => {
      commit((prev) => ({ ...prev, readingDirection: value }))
    },
    [commit]
  )

  const handleReset = React.useCallback(() => {
    commit(() => formSchema.parse(DEFAULT_PREFERENCES))
  }, [commit])

  const aheadPages = React.useMemo(() => formValues.prefetchRadius, [formValues.prefetchRadius])
  const behindPages = aheadPages

  const cacheLabel = React.useMemo(() => `${formValues.cacheBudgetMb} MB`, [formValues.cacheBudgetMb])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}
      <SheetContent
        side="right"
        className="flex h-full w-full max-w-[420px] flex-col gap-6 border-l border-border bg-surface-2/90 backdrop-blur-lg"
      >
        <SheetHeader className="space-y-2 text-left">
          <SheetTitle>Reader Settings</SheetTitle>
          <SheetDescription>
            Tune performance and presentation without leaving the current book. Changes apply immediately and are
            stored locally for future sessions.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-6 overflow-y-auto pr-1">
          <section className="space-y-4 rounded-2xl border border-border/80 bg-surface/60 p-5 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-medium text-text">Prefetch window</h3>
                <p className="text-sm text-muted">
                  Decoder keeps {behindPages} page{behindPages === 1 ? '' : 's'} behind and {aheadPages} ahead ready to
                  display.
                </p>
              </div>
              <span className="rounded-lg border border-border px-3 py-1 text-sm font-medium text-text">
                ±{formValues.prefetchRadius}
              </span>
            </div>
            <label className="flex flex-col gap-3 text-sm text-muted">
              <span className="flex items-center justify-between text-xs uppercase tracking-[0.25em] text-muted">
                Prefetch depth
                <span className="text-text">{formValues.prefetchRadius} pages</span>
              </span>
              <input
                type="range"
                min={0}
                max={8}
                step={1}
                value={formValues.prefetchRadius}
                onChange={(event) => handlePrefetchChange(Number(event.target.value))}
                className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border"
                style={{ accentColor: 'var(--accent)' }}
              />
            </label>
          </section>

          <section className="space-y-4 rounded-2xl border border-border/80 bg-surface/60 p-5 shadow-soft">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-medium text-text">Cache budget</h3>
                <p className="text-sm text-muted">
                  Controls decoded bitmap cache size. Higher values reduce disk churn but increase memory usage.
                </p>
              </div>
              <span className="rounded-lg border border-border px-3 py-1 text-sm font-medium text-text">{cacheLabel}</span>
            </div>
            <div className="grid gap-3">
              <label className="flex flex-col gap-3 text-sm text-muted">
                <span className="flex items-center justify-between text-xs uppercase tracking-[0.25em] text-muted">
                  Cache size
                  <span className="text-text">{cacheLabel}</span>
                </span>
                <input
                  type="range"
                  min={128}
                  max={2048}
                  step={64}
                  value={formValues.cacheBudgetMb}
                  onChange={(event) => handleCacheChange(Number(event.target.value))}
                  className="h-1 w-full cursor-pointer appearance-none rounded-full bg-border"
                  style={{ accentColor: 'var(--accent)' }}
                />
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={128}
                  max={2048}
                  step={64}
                  value={formValues.cacheBudgetMb}
                  onChange={(event) => handleCacheChange(Number(event.target.value))}
                  className="h-10 w-32 text-right"
                />
                <span className="text-sm text-muted">MB</span>
              </div>
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-border/80 bg-surface/60 p-5 shadow-soft">
            <div className="space-y-1.5">
              <h3 className="text-base font-medium text-text">Theme density</h3>
              <p className="text-sm text-muted">Switch between spacious controls or a compact layout for smaller screens.</p>
            </div>
            <div className="flex gap-2">
              {[
                { value: 'comfortable', label: 'Comfortable', description: 'Larger padding, relaxed spacing' },
                { value: 'compact', label: 'Compact', description: 'Tighter spacing, more content' }
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleThemeDensityChange(option.value as SettingsFormValues['themeDensity'])}
                  className={cn(
                    'flex-1 rounded-xl border px-3 py-3 text-left transition-all duration-fast ease-elegant',
                    formValues.themeDensity === option.value
                      ? 'border-accent bg-accent/10 text-text shadow-soft'
                      : 'border-border text-muted hover:border-accent/50 hover:text-text'
                  )}
                >
                  <span className="block text-sm font-medium text-text">{option.label}</span>
                  <span className="mt-1 block text-xs text-muted">{option.description}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-border/80 bg-surface/60 p-5 shadow-soft">
            <div className="space-y-1.5">
              <h3 className="text-base font-medium text-text">Reading direction</h3>
              <p className="text-sm text-muted">Choose left-to-right for western comics or right-to-left for manga layouts.</p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'ltr', label: 'Left → Right', hint: 'Western default' },
                { value: 'rtl', label: 'Right ← Left', hint: 'Manga style' }
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleReadingDirectionChange(option.value as SettingsFormValues['readingDirection'])}
                  className={cn(
                    'rounded-xl border px-3 py-3 text-left transition-all duration-fast ease-elegant',
                    formValues.readingDirection === option.value
                      ? 'border-accent bg-accent/10 text-text shadow-soft'
                      : 'border-border text-muted hover:border-accent/50 hover:text-text'
                  )}
                >
                  <span className="block text-sm font-medium text-text">{option.label}</span>
                  <span className="mt-1 block text-xs text-muted">{option.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-4 rounded-2xl border border-border/80 bg-surface/60 p-5 shadow-soft">
            <KeymapEditor keymap={keymap} />
          </section>
        </div>

        <SheetFooter className="flex flex-col items-stretch justify-between gap-3 border-t border-border/80 pt-4 text-sm">
          <div className="flex items-center justify-between text-xs text-muted">
            <span>Preferences are stored locally on this device.</span>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs font-medium text-accent transition-colors hover:text-accent-2"
            >
              Reset to defaults
            </button>
          </div>
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
