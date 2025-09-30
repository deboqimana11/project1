import * as React from 'react'
import { Download, Pencil, Plus, RefreshCcw, Trash2, Upload, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import {
  KEYMAP_ACTIONS,
  type ActionId,
  type ActionCategory,
  type BindingChangeError,
  type KeymapActionDefinition,
  type ReaderKeymap,
  formatCategory,
  formatTrigger,
  keyboardEventToTrigger,
  pointerEventToTrigger
} from '@/lib/keymap'

interface KeymapEditorProps {
  keymap: ReaderKeymap
}

interface CaptureTarget {
  actionId: ActionId
  existing?: string
}

function ShortcutRecorder({
  active,
  onCommit,
  onCancel
}: {
  active: boolean
  onCommit: (binding: string) => void
  onCancel: () => void
}) {
  React.useEffect(() => {
    if (!active) {
      return
    }
    let cancelled = false
    const activationTimestamp = performance.now() + 80

    const handleKeyDown = (event: KeyboardEvent) => {
      if (cancelled) {
        return
      }
      if (event.key === 'Escape' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
        event.preventDefault()
        cancelled = true
        onCancel()
        return
      }
      if (event.repeat) {
        return
      }
      if (performance.now() < activationTimestamp) {
        return
      }
      const trigger = keyboardEventToTrigger(event)
      if (!trigger) {
        return
      }
      event.preventDefault()
      cancelled = true
      onCommit(trigger)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (cancelled) {
        return
      }
      if (performance.now() < activationTimestamp) {
        return
      }
      const trigger = pointerEventToTrigger(event)
      if (!trigger) {
        return
      }
      event.preventDefault()
      cancelled = true
      onCommit(trigger)
    }

    const handleBlur = () => {
      if (!cancelled) {
        cancelled = true
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    window.addEventListener('pointerup', handlePointerUp, { capture: true })
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true } as EventListenerOptions)
      window.removeEventListener('pointerup', handlePointerUp, { capture: true } as EventListenerOptions)
      window.removeEventListener('blur', handleBlur)
    }
  }, [active, onCancel, onCommit])

  return null
}

function ConflictNotice({ message }: { message: string | null }) {
  if (!message) {
    return null
  }
  return (
    <div className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/60 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <XCircle className="h-4 w-4" />
      <span>{message}</span>
    </div>
  )
}

function ImportPanel({
  visible,
  value,
  onChange,
  onSubmit,
  onCancel,
  error
}: {
  visible: boolean
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  onCancel: () => void
  error: string | null
}) {
  if (!visible) {
    return null
  }
  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-border/70 bg-surface/70 p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold text-text">Import shortcuts</h4>
        <p className="text-sm text-muted">Paste exported JSON, then apply to replace the current keymap.</p>
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-40 w-full resize-none rounded-xl border border-border bg-surface-2 px-3 py-2 text-sm text-text focus:border-accent focus:outline-none"
        placeholder='{"version":1,"bindings":{}}'
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <div className="flex items-center gap-2">
        <Button onClick={onSubmit}>Apply import</Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function bindingErrorMessage(error: BindingChangeError | null) {
  if (!error) {
    return null
  }
  if (error.reason === 'invalid') {
    return 'Unable to recognise that shortcut. Try a different combination.'
  }
  if (error.reason === 'conflict' && error.conflictWith) {
    const conflicting = KEYMAP_ACTIONS.find((action) => action.id === error.conflictWith)
    if (conflicting) {
      return `Shortcut already assigned to "${conflicting.label}". Remove or change that binding first.`
    }
  }
  return 'Shortcut conflicts with an existing mapping.'
}

export function KeymapEditor({ keymap }: KeymapEditorProps) {
  const { bindings, addBinding, replaceBinding, removeBinding, resetAction, resetAll, exportToString, importFromString } = keymap
  const [captureTarget, setCaptureTarget] = React.useState<CaptureTarget | null>(null)
  const [lastError, setLastError] = React.useState<BindingChangeError | null>(null)
  const [importVisible, setImportVisible] = React.useState(false)
  const [importValue, setImportValue] = React.useState('')
  const [importError, setImportError] = React.useState<string | null>(null)

  const sortedActions = React.useMemo(() => {
    return [...KEYMAP_ACTIONS].sort((a, b) => {
      if (a.category === b.category) {
        return a.label.localeCompare(b.label)
      }
      return a.category.localeCompare(b.category)
    })
  }, [])

  const grouped = React.useMemo(() => {
    const groups = new Map<ActionCategory, KeymapActionDefinition[]>()
    for (const action of sortedActions) {
      const list = groups.get(action.category)
      if (list) {
        list.push(action)
      } else {
        groups.set(action.category, [action])
      }
    }
    return groups
  }, [sortedActions])

  const handleCaptureCommit = React.useCallback(
    (binding: string) => {
      if (!captureTarget) {
        return
      }
      let result: BindingChangeError | null
      if (captureTarget.existing) {
        result = replaceBinding(captureTarget.actionId, captureTarget.existing, binding)
      } else {
        result = addBinding(captureTarget.actionId, binding)
      }
      if (result) {
        setLastError(result)
      } else {
        setLastError(null)
      }
      setCaptureTarget(null)
    },
    [addBinding, captureTarget, replaceBinding]
  )

  const handleCaptureCancel = React.useCallback(() => {
    setCaptureTarget(null)
  }, [])

  const handleExport = React.useCallback(() => {
    const data = exportToString()
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard
        .writeText(data)
        .then(() => {
          toast({ title: 'Keymap copied', description: 'JSON placed on the clipboard.' })
        })
        .catch((error) => {
          console.warn('[keymap] Clipboard export failed', error)
          toast({ title: 'Keymap export', description: 'Copy failed. Downloading file instead.' })
          const blob = new Blob([data], { type: 'application/json' })
          const url = URL.createObjectURL(blob)
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = 'reader-keymap.json'
          anchor.click()
          URL.revokeObjectURL(url)
        })
    } else {
      const blob = new Blob([data], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = 'reader-keymap.json'
      anchor.click()
      URL.revokeObjectURL(url)
    }
  }, [exportToString])

  const handleImportSubmit = React.useCallback(() => {
    const result = importFromString(importValue)
    if (!result.ok) {
      setImportError(result.error ?? 'Failed to import keymap.')
      return
    }
    setImportError(null)
    setImportValue('')
    setImportVisible(false)
    toast({ title: 'Shortcuts imported', description: 'Custom keymap applied.' })
  }, [importFromString, importValue])

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold text-text">Keyboard & mouse shortcuts</h3>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportVisible((value) => !value)}>
            <Upload className="mr-2 h-4 w-4" /> Import JSON
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button variant="ghost" size="sm" onClick={() => resetAll()}>
            <RefreshCcw className="mr-2 h-4 w-4" /> Reset all
          </Button>
        </div>
      </header>
      <p className="text-sm text-muted">
        Capture shortcuts with any key combination or mouse button. Conflicts are highlighted so every action stays unique.
      </p>

      <ImportPanel
        visible={importVisible}
        value={importValue}
        onChange={(next) => setImportValue(next)}
        onSubmit={handleImportSubmit}
        onCancel={() => {
          setImportVisible(false)
          setImportError(null)
        }}
        error={importError}
      />

      {Array.from(grouped.entries()).map(([category, actions]) => (
        <section key={category} className="space-y-3 rounded-2xl border border-border/70 bg-surface/60 p-5 shadow-soft">
          <h4 className="text-sm font-semibold uppercase tracking-[0.25em] text-muted">{formatCategory(category)}</h4>
          <div className="space-y-3">
            {actions.map((action) => {
              const assigned = bindings[action.id]
              return (
                <div key={action.id} className="rounded-xl border border-border/80 bg-surface-2/80 p-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-text">{action.label}</p>
                        <p className="text-xs text-muted">{action.description}</p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => resetAction(action.id)} aria-label={`Reset ${action.label}`}>
                        <RefreshCcw className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {assigned.length > 0 ? (
                        assigned.map((binding) => (
                          <div key={binding} className="flex items-center gap-1 rounded-lg border border-border/80 bg-surface/80 px-3 py-1 text-sm text-text">
                            <span>{formatTrigger(binding)}</span>
                            <button
                              type="button"
                              className="text-muted transition-colors hover:text-text"
                              onClick={() => setCaptureTarget({ actionId: action.id, existing: binding })}
                              aria-label={`Change ${formatTrigger(binding)}`}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              className="text-muted transition-colors hover:text-destructive"
                              onClick={() => removeBinding(action.id, binding)}
                              aria-label={`Remove ${formatTrigger(binding)}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))
                      ) : (
                        <span className="rounded-lg border border-border/60 px-3 py-1 text-xs text-muted">No shortcut assigned</span>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCaptureTarget({ actionId: action.id })}
                      >
                        <Plus className="mr-2 h-4 w-4" /> Add shortcut
                      </Button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}

      <ConflictNotice message={bindingErrorMessage(lastError)} />

      <ShortcutRecorder active={Boolean(captureTarget)} onCommit={handleCaptureCommit} onCancel={handleCaptureCancel} />

      {captureTarget ? (
        <div className="fixed inset-x-0 bottom-6 z-50 mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-2xl border border-accent/60 bg-surface/95 px-5 py-3 shadow-soft backdrop-blur">
          <div className="flex flex-col">
            <span className="text-sm font-medium text-text">Press a key or mouse button...</span>
            <span className="text-xs text-muted">
              Press Escape to cancel. Primary-click shortcuts require a modifier.
            </span>
          </div>
          <Button variant="ghost" onClick={handleCaptureCancel}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  )
}
