import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  LayoutGrid,
  LayoutList,
  RotateCcw,
  RotateCw,
  Settings2,
  Square,
  StretchHorizontal,
  StretchVertical,
  Undo2
} from 'lucide-react'

import type { FitMode, PageMeta } from '@/ipc'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut
} from '@/components/ui/command'

import type { ReadingDirection, ReadingLayout } from './toolbar'
import type { Rotation } from './view-model'
import type { ActionId } from '@/lib/keymap'

type PaletteGroup = 'quick' | 'display' | 'pages' | 'direct'

interface PaletteItemBase {
  id: string
  label: string
  keywords: string
  group: PaletteGroup
  icon?: React.ReactNode
  description?: string
  shortcut?: string
  actionId?: ActionId
  disabled?: boolean
  onSelect: () => void
}

interface CommandPaletteProps {
  pages: PageMeta[]
  activeIndex: number
  fitMode: FitMode
  readingLayout: ReadingLayout
  readingDirection: ReadingDirection
  rotation: Rotation
  open?: boolean
  onOpenChange?: (open: boolean) => void
  onSelectPage: (index: number) => void
  onFitModeChange: (mode: FitMode) => void
  onReadingLayoutChange: (layout: ReadingLayout) => void
  onReadingDirectionChange: (direction: ReadingDirection) => void
  onRotateClockwise: () => void
  onRotateCounterClockwise: () => void
  onResetRotation: () => void
  onOpenLibrary?: () => void
  onOpenSettings?: () => void
  shortcutForAction?: (actionId: ActionId) => string | undefined
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function scoreMatch(query: string, target: string) {
  if (!query) {
    return 0
  }
  const normalizedTarget = normalize(target)
  const normalizedQuery = normalize(query)
  if (!normalizedTarget || !normalizedQuery) {
    return Number.POSITIVE_INFINITY
  }
  const index = normalizedTarget.indexOf(normalizedQuery)
  if (index >= 0) {
    return index
  }
  // Fallback to subsequence matching.
  let score = 0
  let searchIndex = 0
  for (const char of normalizedQuery) {
    const foundIndex = normalizedTarget.indexOf(char, searchIndex)
    if (foundIndex === -1) {
      return Number.POSITIVE_INFINITY
    }
    score += foundIndex - searchIndex
    searchIndex = foundIndex + 1
  }
  return score + normalizedTarget.length - normalizedQuery.length
}

export function CommandPalette({
  pages,
  activeIndex,
  fitMode,
  readingLayout,
  readingDirection,
  rotation,
  open: openProp,
  onOpenChange,
  onSelectPage,
  onFitModeChange,
  onReadingLayoutChange,
  onReadingDirectionChange,
  onRotateClockwise,
  onRotateCounterClockwise,
  onResetRotation,
  onOpenLibrary,
  onOpenSettings,
  shortcutForAction
}: CommandPaletteProps) {
  const isControlled = typeof openProp === 'boolean'
  const [internalOpen, setInternalOpen] = React.useState(false)
  const open = isControlled ? openProp ?? false : internalOpen

  const [query, setQuery] = React.useState('')

  const setOpen = React.useCallback(
    (value: boolean) => {
      if (!isControlled) {
        setInternalOpen(value)
      }
      onOpenChange?.(value)
    },
    [isControlled, onOpenChange]
  )

  React.useEffect(() => {
    if (!open) {
      setQuery('')
    }
  }, [open])

  const totalPages = pages.length

  const safeSelectPage = React.useCallback(
    (index: number) => {
      if (totalPages === 0) {
        return
      }
      const clamped = Math.min(Math.max(index, 0), totalPages - 1)
      onSelectPage(clamped)
    },
    [onSelectPage, totalPages]
  )

  const baseQuickActions = React.useMemo<PaletteItemBase[]>(() => {
    const items: PaletteItemBase[] = []

    if (totalPages > 0) {
      items.push(
        {
          id: 'next-page',
          label: 'Next page',
          keywords: 'next forward page',
          group: 'quick',
          icon: <ArrowRight className="h-4 w-4" />, 
          shortcut: '→',
          actionId: 'reader.page.next',
          disabled: activeIndex >= totalPages - 1,
          onSelect: () => safeSelectPage(activeIndex + 1)
        },
        {
          id: 'previous-page',
          label: 'Previous page',
          keywords: 'prev back page',
          group: 'quick',
          icon: <ArrowLeft className="h-4 w-4" />, 
          shortcut: '←',
          actionId: 'reader.page.previous',
          disabled: activeIndex <= 0,
          onSelect: () => safeSelectPage(activeIndex - 1)
        },
        {
          id: 'first-page',
          label: 'First page',
          keywords: 'start beginning page 1',
          group: 'quick',
          icon: <ChevronsLeft className="h-4 w-4" />,
          shortcut: 'Home',
          actionId: 'reader.page.first',
          disabled: activeIndex === 0,
          onSelect: () => safeSelectPage(0)
        },
        {
          id: 'last-page',
          label: 'Last page',
          keywords: 'end final',
          group: 'quick',
          icon: <ChevronsRight className="h-4 w-4" />,
          shortcut: 'End',
          actionId: 'reader.page.last',
          disabled: activeIndex === totalPages - 1,
          onSelect: () => safeSelectPage(totalPages - 1)
        }
      )
    }

    if (onOpenLibrary) {
      items.push({
        id: 'open-library',
        label: 'Open library',
        keywords: 'library folder open import',
        group: 'quick',
        icon: <BookOpen className="h-4 w-4" />, 
        shortcut: 'Ctrl+O',
        actionId: 'reader.library.open',
        onSelect: onOpenLibrary
      })
    }

    if (onOpenSettings) {
      items.push({
        id: 'open-settings',
        label: 'Open reader settings',
        keywords: 'settings preferences options',
        group: 'quick',
        icon: <Settings2 className="h-4 w-4" />, 
        shortcut: 'Ctrl+,',
        actionId: 'reader.settings.open',
        onSelect: onOpenSettings
      })
    }

    return items
  }, [activeIndex, onOpenLibrary, onOpenSettings, safeSelectPage, totalPages])

  const displayCommands = React.useMemo<PaletteItemBase[]>(() => [
    {
      id: 'fit-contain',
      label: 'Best fit',
      keywords: 'fit contain screen auto',
      group: 'display',
      icon: <Square className="h-4 w-4" />, 
      shortcut: '0',
      actionId: 'reader.fit.contain',
      disabled: fitMode === 'fitContain',
      onSelect: () => {
        onFitModeChange('fitContain')
        setOpen(false)
      }
    },
    {
      id: 'fit-original',
      label: 'Original size',
      keywords: 'original size actual 100%',
      group: 'display',
      icon: <LayoutGrid className="h-4 w-4" />, 
      shortcut: '1',
      actionId: 'reader.fit.original',
      disabled: fitMode === 'original',
      onSelect: () => {
        onFitModeChange('original')
        setOpen(false)
      }
    },
    {
      id: 'fit-width',
      label: 'Fit width',
      keywords: 'fit width horizontal',
      group: 'display',
      icon: <StretchHorizontal className="h-4 w-4" />, 
      shortcut: '2',
      actionId: 'reader.fit.width',
      disabled: fitMode === 'fitWidth',
      onSelect: () => {
        onFitModeChange('fitWidth')
        setOpen(false)
      }
    },
    {
      id: 'fit-height',
      label: 'Fit height',
      keywords: 'fit height vertical',
      group: 'display',
      icon: <StretchVertical className="h-4 w-4" />, 
      shortcut: '3',
      actionId: 'reader.fit.height',
      disabled: fitMode === 'fitHeight',
      onSelect: () => {
        onFitModeChange('fitHeight')
        setOpen(false)
      }
    },
    {
      id: 'layout-single',
      label: 'Single page layout',
      keywords: 'single page layout',
      group: 'display',
      icon: <LayoutList className="h-4 w-4" />, 
      shortcut: 'S',
      actionId: 'reader.layout.single',
      disabled: readingLayout === 'single',
      onSelect: () => {
        onReadingLayoutChange('single')
        setOpen(false)
      }
    },
    {
      id: 'layout-double',
      label: 'Double page layout',
      keywords: 'double page spread',
      group: 'display',
      icon: <LayoutGrid className="h-4 w-4" />, 
      shortcut: 'D',
      actionId: 'reader.layout.double',
      disabled: readingLayout === 'double',
      onSelect: () => {
        onReadingLayoutChange('double')
        setOpen(false)
      }
    },
    {
      id: 'layout-vertical',
      label: 'Continuous scroll layout',
      keywords: 'vertical scroll continuous',
      group: 'display',
      icon: <StretchVertical className="h-4 w-4" />, 
      shortcut: 'C',
      actionId: 'reader.layout.vertical',
      disabled: readingLayout === 'vertical',
      onSelect: () => {
        onReadingLayoutChange('vertical')
        setOpen(false)
      }
    },
    {
      id: 'toggle-direction',
      label: readingDirection === 'rtl' ? 'Switch to left-to-right' : 'Switch to right-to-left',
      keywords: 'toggle reading direction',
      group: 'display',
      icon: <StretchHorizontal className="h-4 w-4" />, 
      shortcut: 'L',
      actionId: 'reader.layout.toggle-direction',
      onSelect: () => {
        onReadingDirectionChange(readingDirection === 'rtl' ? 'ltr' : 'rtl')
        setOpen(false)
      }
    },
    {
      id: 'rotate-clockwise',
      label: 'Rotate clockwise',
      keywords: 'rotate clockwise turn right',
      group: 'display',
      icon: <RotateCw className="h-4 w-4" />, 
      shortcut: 'R',
      actionId: 'reader.rotate.cw',
      onSelect: () => {
        onRotateClockwise()
        setOpen(false)
      }
    },
    {
      id: 'rotate-counterclockwise',
      label: 'Rotate counterclockwise',
      keywords: 'rotate counter clockwise turn left',
      group: 'display',
      icon: <RotateCcw className="h-4 w-4" />, 
      shortcut: 'Shift+R',
      actionId: 'reader.rotate.ccw',
      onSelect: () => {
        onRotateCounterClockwise()
        setOpen(false)
      }
    },
    {
      id: 'reset-rotation',
      label: 'Reset rotation',
      keywords: 'reset rotation angle 0',
      group: 'display',
      icon: <Undo2 className="h-4 w-4" />, 
      shortcut: 'Ctrl+R',
      actionId: 'reader.rotate.reset',
      disabled: rotation === 0,
      onSelect: () => {
        onResetRotation()
        setOpen(false)
      }
    }
  ], [fitMode, onFitModeChange, onReadingDirectionChange, onReadingLayoutChange, onResetRotation, onRotateClockwise, onRotateCounterClockwise, readingDirection, readingLayout, rotation, setOpen])

  const pageItems = React.useMemo(() => {
    return pages.map<PaletteItemBase>((page, index) => ({
      id: `page-${index + 1}`,
      label: `Go to page ${index + 1}`,
      description: page.relPath,
      keywords: `${index + 1} ${page.relPath}`,
      group: 'pages',
      onSelect: () => safeSelectPage(index)
    }))
  }, [pages, safeSelectPage])

  const normalizedQuery = query.trim().toLowerCase()
  const showAll = normalizedQuery.length === 0
  const numericMatch = normalizedQuery !== '' && /^\d+$/.test(normalizedQuery) ? Number.parseInt(normalizedQuery, 10) : null
  const inRangeNumeric =
    numericMatch !== null && Number.isFinite(numericMatch) && numericMatch >= 1 && numericMatch <= totalPages

  const filteredQuick = React.useMemo(() => {
    if (showAll) {
      return baseQuickActions
    }
    return baseQuickActions
      .map((item) => ({ item, score: scoreMatch(normalizedQuery, item.keywords + ' ' + item.label) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((a, b) => a.score - b.score)
      .map(({ item }) => item)
  }, [baseQuickActions, normalizedQuery, showAll])

  const filteredDisplay = React.useMemo(() => {
    if (showAll) {
      return displayCommands
    }
    return displayCommands
      .map((item) => ({ item, score: scoreMatch(normalizedQuery, item.keywords + ' ' + item.label) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((a, b) => a.score - b.score)
      .map(({ item }) => item)
  }, [displayCommands, normalizedQuery, showAll])

  const filteredPages = React.useMemo(() => {
    if (totalPages === 0) {
      return []
    }
    if (showAll) {
      const start = Math.max(activeIndex - 4, 0)
      return pageItems.slice(start, start + 12)
    }
    return pageItems
      .map((item) => ({ item, score: scoreMatch(normalizedQuery, `${item.keywords} ${item.label}`) }))
      .filter(({ score }) => Number.isFinite(score))
      .sort((a, b) => a.score - b.score)
      .slice(0, 20)
      .map(({ item }) => item)
  }, [activeIndex, normalizedQuery, pageItems, showAll, totalPages])

  const directPageItem = React.useMemo<PaletteItemBase | null>(() => {
    if (!inRangeNumeric || numericMatch === null) {
      return null
    }
    const targetIndex = numericMatch - 1
    return {
      id: `jump-${numericMatch}`,
      label: `Go to page ${numericMatch}`,
      keywords: `${numericMatch} jump goto`,
      group: 'direct',
      description: totalPages > 0 ? `Page ${numericMatch} of ${totalPages}` : undefined,
      onSelect: () => safeSelectPage(targetIndex)
    }
  }, [inRangeNumeric, numericMatch, safeSelectPage, totalPages])

  const handleSelect = React.useCallback(
    (item: PaletteItemBase) => {
      if (item.disabled) {
        return
      }
      item.onSelect()
      setOpen(false)
    },
    [setOpen]
  )

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-surface/60 backdrop-blur-lg" />
        <DialogPrimitive.Content className="fixed left-1/2 top-[10vh] z-50 w-full max-w-xl -translate-x-1/2 px-4 focus:outline-none">
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Jump to reader pages, change layouts, or run quick actions.
          </DialogPrimitive.Description>

          <Command className="overflow-hidden border border-border bg-surface/95 shadow-soft backdrop-blur-lg">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Jump to a page or search commands…"
            />
            <CommandList>
              <CommandEmpty>No commands found.</CommandEmpty>

              {directPageItem && (
                <CommandGroup heading="Go to page">
                  <CommandItem value={directPageItem.id} onSelect={() => handleSelect(directPageItem)}>
                    <div className="flex flex-col">
                      <span>{directPageItem.label}</span>
                      {directPageItem.description && (
                        <span className="text-xs text-muted">{directPageItem.description}</span>
                      )}
                    </div>
                  </CommandItem>
                </CommandGroup>
              )}

              {filteredQuick.length > 0 && (
                <CommandGroup heading="Quick actions">
                  {filteredQuick.map((item) => {
                    const resolvedShortcut = item.actionId && shortcutForAction ? shortcutForAction(item.actionId) : item.shortcut
                    return (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        disabled={item.disabled}
                        onSelect={() => handleSelect(item)}
                      >
                        {item.icon && <span className="mr-3 text-muted">{item.icon}</span>}
                        <span>{item.label}</span>
                        {resolvedShortcut && <CommandShortcut>{resolvedShortcut}</CommandShortcut>}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}

              {filteredQuick.length > 0 && filteredDisplay.length > 0 && <CommandSeparator />}

              {filteredDisplay.length > 0 && (
                <CommandGroup heading="Layout & fit">
                  {filteredDisplay.map((item) => {
                    const resolvedShortcut = item.actionId && shortcutForAction ? shortcutForAction(item.actionId) : item.shortcut
                    return (
                      <CommandItem
                        key={item.id}
                        value={item.id}
                        disabled={item.disabled}
                        onSelect={() => handleSelect(item)}
                      >
                        {item.icon && <span className="mr-3 text-muted">{item.icon}</span>}
                        <span>{item.label}</span>
                        {resolvedShortcut && <CommandShortcut>{resolvedShortcut}</CommandShortcut>}
                        {item.disabled && <span className="ml-3 text-xs uppercase tracking-[0.2em] text-accent">Active</span>}
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
              )}

              {filteredPages.length > 0 && (
                <>
                  {(filteredQuick.length > 0 || filteredDisplay.length > 0 || directPageItem) && (
                    <CommandSeparator />
                  )}
                  <CommandGroup heading="Pages">
                    {filteredPages.map((item) => (
                      <CommandItem key={item.id} value={item.id} onSelect={() => handleSelect(item)}>
                        <div className="flex flex-col">
                          <span>{item.label}</span>
                          {item.description && (
                            <span className="text-xs text-muted">{item.description}</span>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export default CommandPalette
