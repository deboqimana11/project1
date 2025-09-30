import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PageMeta, PerfStats, SourceId } from '@/ipc'
import { fetchStats, listPages, openPath, queryProgress, saveProgress } from '@/ipc'
import {
  CommandPalette,
  ReaderOverlay,
  ReaderViewport,
  SettingsSheet,
  ThumbSidebar,
  Toolbar,
  useReaderViewModel,
  type ReadingDirection,
  type ReadingLayout
} from '@/components/reader'
import {
  clampGroupIndex,
  createPageGroups,
  findGroupIndexByPage,
  getGroupPageNumbers
} from '@/components/reader/page-groups'

import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
import { Toaster } from '@/components/ui/toaster'
import { toast } from '@/components/ui/use-toast'
import { useReaderPreferences } from '@/lib/preferences'
import { cn } from '@/lib/utils'
import { useReaderKeymap, useKeymapEventBridge, formatTrigger, type ActionId } from '@/lib/keymap'

const frameworks = [
  { value: 'tauri', label: 'Tauri' },
  { value: 'egui', label: 'egui' },
  { value: 'iced', label: 'Iced' },
  { value: 'flutter', label: 'Flutter' }
]

function App() {
  const [sheetOpen, setSheetOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [sourceId, setSourceId] = useState<SourceId | null>(null)
  const [pages, setPages] = useState<PageMeta[]>([])
  const [activeIndex, setActiveIndex] = useState(0)
  const [stats, setStats] = useState<PerfStats | null>(null)
  const [readingLayout, setReadingLayout] = useState<ReadingLayout>('single')
  const [readerContainer, setReaderContainer] = useState<HTMLDivElement | null>(null)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const { preferences, setPreferences, updatePreferences } = useReaderPreferences()
  const viewModel = useReaderViewModel()
  const keymap = useReaderKeymap()
  const lastSavedProgressRef = useRef<{ sourceId: SourceId | null; page: number }>({ sourceId: null, page: -1 })
  const restoredProgressRef = useRef<SourceId | null>(null)

  useEffect(() => {
    lastSavedProgressRef.current = { sourceId: null, page: -1 }
    restoredProgressRef.current = null
  }, [sourceId])

  const {
    fitMode,
    zoom,
    rotation,
    setFitMode,
    setZoom,
    setRotation,
    zoomIn,
    zoomOut,
    rotateClockwise,
    rotateCounterClockwise,
    resetView,
    minZoom,
    maxZoom,
    zoomStep
  } = viewModel

  const readingDirection = preferences.readingDirection as ReadingDirection

  const pageGroups = useMemo(() => createPageGroups(pages, readingLayout), [pages, readingLayout])

  const rawActiveGroupIndex = useMemo(() => {
    if (pageGroups.length === 0) {
      return -1
    }
    const found = findGroupIndexByPage(pageGroups, activeIndex)
    if (found !== -1) {
      return found
    }
    if (activeIndex < pageGroups[0].startIndex) {
      return 0
    }
    return pageGroups.length - 1
  }, [activeIndex, pageGroups])

  const normalizedGroupIndex = useMemo(() => {
    if (pageGroups.length === 0) {
      return -1
    }
    if (rawActiveGroupIndex === -1) {
      return 0
    }
    return clampGroupIndex(pageGroups, rawActiveGroupIndex)
  }, [pageGroups, rawActiveGroupIndex])

  useEffect(() => {
    if (readingLayout !== 'double') {
      return
    }
    if (pageGroups.length === 0) {
      return
    }
    const targetGroup = rawActiveGroupIndex === -1 ? pageGroups[0] : pageGroups[rawActiveGroupIndex]
    if (!targetGroup) {
      return
    }
    if (activeIndex !== targetGroup.startIndex) {
      setActiveIndex(targetGroup.startIndex)
    }
  }, [activeIndex, pageGroups, rawActiveGroupIndex, readingLayout, setActiveIndex])

  const activeGroup = normalizedGroupIndex === -1 ? null : pageGroups[normalizedGroupIndex] ?? null
  const currentPageNumbers = useMemo(() => getGroupPageNumbers(activeGroup), [activeGroup])

  const currentPageLabel = useMemo(() => {
    if (currentPageNumbers.length === 0) {
      return null
    }
    if (currentPageNumbers.length === 1) {
      return String(currentPageNumbers[0])
    }
    if (readingDirection === 'rtl') {
      return [...currentPageNumbers].reverse().join('-')
    }
    return `${currentPageNumbers[0]}-${currentPageNumbers[currentPageNumbers.length - 1]}`
  }, [currentPageNumbers, readingDirection])

  const currentPageNumber = currentPageNumbers.length > 0 ? currentPageNumbers[0] : pages.length > 0 ? Math.min(activeIndex + 1, pages.length) : 1
  const totalPages = pages.length || 320
  const canGoForward = pageGroups.length > 0 && normalizedGroupIndex !== -1 && (
    readingDirection === 'ltr' ? normalizedGroupIndex < pageGroups.length - 1 : normalizedGroupIndex > 0
  )
  const canGoBack = pageGroups.length > 0 && normalizedGroupIndex !== -1 && (
    readingDirection === 'ltr' ? normalizedGroupIndex > 0 : normalizedGroupIndex < pageGroups.length - 1
  )
  const activeThumbIndex = activeGroup?.startIndex ?? (pages.length > 0 ? Math.min(activeIndex, pages.length - 1) : 0)
  const hasPages = pages.length > 0
  const activeGroupStartIndex = activeGroup ? activeGroup.startIndex : null
  const pageIndexForProgress = useMemo(() => {
    if (!hasPages) {
      return -1
    }
    if (activeGroupStartIndex !== null) {
      return activeGroupStartIndex
    }
    return Math.min(activeIndex, pages.length - 1)
  }, [activeGroupStartIndex, activeIndex, hasPages, pages.length])

  useEffect(() => {
    if (!sourceId || !hasPages) {
      return
    }
    if (restoredProgressRef.current !== sourceId) {
      return
    }
    if (pageIndexForProgress < 0) {
      return
    }
    if (
      lastSavedProgressRef.current.sourceId === sourceId &&
      lastSavedProgressRef.current.page === pageIndexForProgress
    ) {
      return
    }

    let cancelled = false

    void (async () => {
      try {
        await saveProgress(sourceId, pageIndexForProgress)
        if (!cancelled) {
          lastSavedProgressRef.current = { sourceId, page: pageIndexForProgress }
        }
      } catch (error) {
        if (!cancelled) {
          console.warn('[progress] Failed to save progress', error)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sourceId, hasPages, pageIndexForProgress])

  useEffect(() => {
    if (!sourceId || pages.length === 0) {
      return
    }
    if (restoredProgressRef.current === sourceId) {
      return
    }
    let cancelled = false

    void (async () => {
      try {
        const stored = await queryProgress(sourceId)
        if (cancelled) {
          return
        }
        if (pages.length === 0) {
          return
        }
        const safeIndex = Math.min(Math.max(stored, 0), pages.length - 1)
        setActiveIndex(safeIndex)
        lastSavedProgressRef.current = { sourceId, page: safeIndex }
        restoredProgressRef.current = sourceId
      } catch (error) {
        if (!cancelled) {
          console.warn('[progress] Failed to restore progress', error)
          restoredProgressRef.current = sourceId
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sourceId, pages])

  useEffect(() => {
    if (pages.length === 0) {
      if (activeIndex !== 0) {
        setActiveIndex(0)
      }
      return
    }
    if (activeIndex > pages.length - 1) {
      setActiveIndex(pages.length - 1)
    }
  }, [pages, activeIndex])

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    const root = document.documentElement
    root.dataset.readerDensity = preferences.themeDensity
    return () => {
      delete root.dataset.readerDensity
    }
  }, [preferences.themeDensity])

  const handleLoadDemo = useCallback(async () => {
    setLoading(true)
    try {
      const id = await openPath('demo-bundle')
      setSourceId(id)

      const items = await listPages(id)
      setPages(items)
      setActiveIndex(0)

      const metrics = await fetchStats()
      setStats(metrics)

      toast({
        variant: 'success',
        title: 'Commands ready',
        description: `Loaded ${items.length} mock pages for ${id}.`
      })
    } catch (error) {
      console.error('IPC call failed', error)
      toast({
        variant: 'destructive',
        title: 'IPC unavailable',
        description:
          error instanceof Error ? error.message : 'Failed to reach the Tauri backend. Start the app shell to enable IPC.'
      })
    } finally {
      setLoading(false)
    }
  }, [setActiveIndex, setLoading, setPages, setSourceId, setStats])

  const handleZoomChange = useCallback((next: number) => {
    setZoom(next)
  }, [setZoom])

  const handleZoomIn = useCallback(() => {
    zoomIn()
  }, [zoomIn])

  const handleZoomOut = useCallback(() => {
    zoomOut()
  }, [zoomOut])

  const handleResetRotation = useCallback(() => {
    setRotation(0)
  }, [setRotation])

  const handleNavigateBack = useCallback(() => {
    if (pageGroups.length === 0) {
      return
    }
    const current = normalizedGroupIndex === -1 ? 0 : normalizedGroupIndex
    if (readingDirection === 'ltr') {
      if (current > 0) {
        setActiveIndex(pageGroups[current - 1].startIndex)
      }
      return
    }
    if (current < pageGroups.length - 1) {
      setActiveIndex(pageGroups[current + 1].startIndex)
    }
  }, [normalizedGroupIndex, pageGroups, readingDirection, setActiveIndex])

  const handleNavigateForward = useCallback(() => {
    if (pageGroups.length === 0) {
      return
    }
    const current = normalizedGroupIndex === -1 ? 0 : normalizedGroupIndex
    if (readingDirection === 'ltr') {
      if (current < pageGroups.length - 1) {
        setActiveIndex(pageGroups[current + 1].startIndex)
      }
      return
    }
    if (current > 0) {
      setActiveIndex(pageGroups[current - 1].startIndex)
    }
  }, [normalizedGroupIndex, pageGroups, readingDirection, setActiveIndex])

  const handleReadingDirectionChange = useCallback(
    (direction: ReadingDirection) => {
      updatePreferences((prev) => ({ ...prev, readingDirection: direction }))
    },
    [updatePreferences]
  )

  const handleGoToFirstPage = useCallback(() => {
    if (pageGroups.length === 0) {
      return
    }
    setActiveIndex(pageGroups[0].startIndex)
  }, [pageGroups, setActiveIndex])

  const handleGoToLastPage = useCallback(() => {
    if (pageGroups.length === 0) {
      return
    }
    const lastGroup = pageGroups[pageGroups.length - 1]
    setActiveIndex(lastGroup.startIndex)
  }, [pageGroups, setActiveIndex])

  const handleJumpToPage = useCallback(() => {
    if (pages.length === 0) {
      return
    }
    const input = window.prompt(`Go to page (1 - ${pages.length})`, String(currentPageNumber))
    if (!input) {
      return
    }
    const parsed = Number.parseInt(input, 10)
    if (!Number.isFinite(parsed)) {
      toast({
        variant: 'destructive',
        title: 'Invalid page',
        description: 'Please enter a valid page number.'
      })
      return
    }
    const clamped = Math.min(Math.max(parsed, 1), pages.length)
    setActiveIndex(clamped - 1)
  }, [currentPageNumber, pages.length, setActiveIndex])

  const handleSetLayoutSingle = useCallback(() => {
    setReadingLayout('single')
  }, [])

  const handleSetLayoutDouble = useCallback(() => {
    setReadingLayout('double')
  }, [])

  const handleSetLayoutVertical = useCallback(() => {
    setReadingLayout('vertical')
  }, [])

  const handleToggleReadingDirection = useCallback(() => {
    handleReadingDirectionChange(readingDirection === 'ltr' ? 'rtl' : 'ltr')
  }, [handleReadingDirectionChange, readingDirection])

  const handleFitOriginal = useCallback(() => {
    setFitMode('original')
  }, [setFitMode])

  const handleFitWidth = useCallback(() => {
    setFitMode('fitWidth')
  }, [setFitMode])

  const handleFitHeight = useCallback(() => {
    setFitMode('fitHeight')
  }, [setFitMode])

  const handleFitContain = useCallback(() => {
    setFitMode('fitContain')
  }, [setFitMode])

  const handleResetView = useCallback(() => {
    resetView()
    handleResetRotation()
  }, [handleResetRotation, resetView])

  const handleToggleCommandPalette = useCallback(() => {
    setCommandPaletteOpen((prev) => !prev)
  }, [])

  const handleOpenSettingsSheet = useCallback(() => {
    setSheetOpen(true)
  }, [])

  const handleOpenLibrary = useCallback(() => {
    void (async () => {
      let selection: string | string[] | null = null
      try {
        // Lazy import to avoid bundling in non-tauri preview
        const { open } = await import('@tauri-apps/plugin-dialog')
        // First try: files/archives
        selection = await open({
          multiple: true,
          directory: false,
          title: 'Import images or CBZ/ZIP',
          filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'] },
            { name: 'Archives', extensions: ['cbz', 'zip'] }
          ]
        })

        // If user cancels, offer folder import as an alternative
        if (!selection || (Array.isArray(selection) && selection.length === 0)) {
          selection = await open({
            multiple: false,
            directory: true,
            title: 'Import a folder of images'
          })
          if (!selection || (Array.isArray(selection) && selection.length === 0)) {
            return
          }
        }

        const path = Array.isArray(selection) ? selection[0] : selection
        setLoading(true)
        try {
          const id = await openPath(path)
          setSourceId(id)
          const items = await listPages(id)
          setPages(items)
          setActiveIndex(0)
          const metrics = await fetchStats()
          setStats(metrics)
          toast({ variant: 'success', title: 'Imported', description: `Loaded ${items.length} pages.` })
        } finally {
          setLoading(false)
        }
      } catch (error) {
        if (!selection) {
          console.warn('[import] Dialog plugin unavailable, loading demo bundle instead', error)
          await handleLoadDemo()
          toast({
            variant: 'info',
            title: 'Demo mode',
            description: 'Running outside the Tauri shell. Loaded the mock bundle instead.'
          })
          return
        }

        console.error('Import failed', error)
        toast({
          variant: 'destructive',
          title: 'Import failed',
          description:
            error instanceof Error ? error.message : 'Unable to import selection. Check file permissions and try again.'
        })
      }
    })()
  }, [fetchStats, handleLoadDemo, listPages, openPath, setActiveIndex, setPages, setSourceId, setStats])

  const handleToggleFullscreen = useCallback(() => {
    if (typeof document === 'undefined') {
      return
    }
    if (!document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch((error) => {
        console.warn('[fullscreen] Failed to enter fullscreen', error)
        toast({ variant: 'destructive', title: 'Fullscreen failed', description: 'Fullscreen mode is unavailable.' })
      })
    } else {
      void document.exitFullscreen().catch((error) => {
        console.warn('[fullscreen] Failed to exit fullscreen', error)
      })
    }
  }, [])

  const handleToggleImmersive = useCallback(() => {
    toast({
      variant: 'info',
      title: 'Immersive mode coming soon',
      description: 'Reader chrome hiding will arrive with the overlay milestone.'
    })
  }, [])

  const handleToggleBookmark = useCallback(() => {
    const label = currentPageLabel ?? String(currentPageNumber)
    toast({
      variant: 'info',
      title: 'Bookmark placeholder',
      description: `Bookmarks will be available soon. Marked page ${label}.`
    })
  }, [currentPageLabel, currentPageNumber])

  const collectionLabel = useMemo(() => {
    if (sourceId) {
      return sourceId
    }
    return 'demo-bundle.cbz'
  }, [sourceId])

  const shortcutForAction = useCallback((actionId: ActionId) => {
    const binding = keymap.bindings[actionId]?.[0]
    return binding ? formatTrigger(binding) : undefined
  }, [keymap.bindings])

  const keymapHandlers = useMemo<Partial<Record<ActionId, () => void>>>(() => ({
    'reader.page.next': handleNavigateForward,
    'reader.page.previous': handleNavigateBack,
    'reader.page.first': handleGoToFirstPage,
    'reader.page.last': handleGoToLastPage,
    'reader.page.jump': handleJumpToPage,
    'reader.layout.single': handleSetLayoutSingle,
    'reader.layout.double': handleSetLayoutDouble,
    'reader.layout.vertical': handleSetLayoutVertical,
    'reader.layout.toggle-direction': handleToggleReadingDirection,
    'reader.fit.original': handleFitOriginal,
    'reader.fit.width': handleFitWidth,
    'reader.fit.height': handleFitHeight,
    'reader.fit.contain': handleFitContain,
    'reader.zoom.in': handleZoomIn,
    'reader.zoom.out': handleZoomOut,
    'reader.zoom.reset': handleResetView,
    'reader.rotate.cw': rotateClockwise,
    'reader.rotate.ccw': rotateCounterClockwise,
    'reader.rotate.reset': handleResetRotation,
    'reader.command.palette': handleToggleCommandPalette,
    'reader.settings.open': handleOpenSettingsSheet,
    'reader.library.open': handleOpenLibrary,
    'reader.fullscreen.toggle': handleToggleFullscreen,
    'reader.fullscreen.immersive': handleToggleImmersive,
    'reader.bookmark.toggle': handleToggleBookmark
  }), [
    handleFitContain,
    handleFitHeight,
    handleFitOriginal,
    handleFitWidth,
    handleGoToFirstPage,
    handleGoToLastPage,
    handleJumpToPage,
    handleNavigateBack,
    handleNavigateForward,
    handleOpenLibrary,
    handleOpenSettingsSheet,
    handleResetRotation,
    handleResetView,
    handleSetLayoutDouble,
    handleSetLayoutSingle,
    handleSetLayoutVertical,
    handleToggleBookmark,
    handleToggleCommandPalette,
    handleToggleFullscreen,
    handleToggleImmersive,
    handleToggleReadingDirection,
    handleZoomIn,
    handleZoomOut,
    rotateClockwise,
    rotateCounterClockwise
  ])

  useKeymapEventBridge(keymap.triggerMap, keymapHandlers)

  return (
    <div className="min-h-screen bg-bg text-text">
          <Toolbar
            sourceName={collectionLabel}
            currentPage={currentPageNumber}
            currentPageLabel={currentPageLabel ?? undefined}
            totalPages={totalPages}
            zoom={zoom}
            rotation={rotation}
            fitMode={fitMode}
            readingLayout={readingLayout}
            readingDirection={readingDirection}
            canNavigateBack={canGoBack}
            canNavigateForward={canGoForward}
            onNavigateBack={handleNavigateBack}
            onNavigateForward={handleNavigateForward}
            onOpenLibrary={handleOpenLibrary}
            onZoomChange={handleZoomChange}
            onFitModeChange={setFitMode}
            onReadingLayoutChange={setReadingLayout}
            onReadingDirectionToggle={handleReadingDirectionChange}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            minZoom={minZoom}
            maxZoom={maxZoom}
            zoomStep={zoomStep}
            onRotateClockwise={rotateClockwise}
            onRotateCounterClockwise={rotateCounterClockwise}
            onResetRotation={handleResetRotation}
            onOpenSearch={() =>
              toast({
                variant: 'info',
                title: 'Search coming soon',
                description: 'The contextual search drawer will arrive with the sidebar milestone.'
              })
            }
            onOpenCommandPalette={() => setCommandPaletteOpen(true)}
            onOpenSettings={() => setSheetOpen(true)}
          />

      <div className="flex">
        <ThumbSidebar
          pages={pages}
          activeIndex={activeThumbIndex}
          onSelect={(index) => setActiveIndex(index)}
          onContextMenuRequest={(page) =>
            toast({
              variant: 'info',
              title: 'Page menu',
              description: `Context actions for ${page.relPath} arrive with the reader milestone.`,
              duration: 2500
            })
          }
        />

        <div
          className={cn(
            'flex flex-1 flex-col px-6 transition-colors duration-mid ease-elegant',
            preferences.themeDensity === 'compact' ? 'gap-8 py-12' : 'gap-12 py-16'
          )}
        >
          <header className="mx-auto flex w-full max-w-4xl flex-col items-center gap-3 text-center">
            <p className="text-sm uppercase tracking-[0.3em] text-muted">UI Foundations</p>
            <h1 className="text-4xl font-semibold tracking-tight">Design Tokens + shadcn/ui are ready</h1>
            <p className="max-w-2xl text-base leading-relaxed text-muted">
              Core primitives from shadcn/ui and Radix are wired up against the shared OKLCH palette. Use
              these drop-in components to build the reader shell without re-implementing base patterns.
            </p>
          </header>

          <main className="mx-auto grid w-full max-w-5xl gap-8 lg:grid-cols-2">
          <section className="space-y-6 rounded-xl border border-border bg-surface-2 p-8 shadow-soft backdrop-blur-lg">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Buttons & Inputs</h2>
              <p className="text-sm text-muted">
                Variants map to the palette, including accent + destructive styles.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button>Primary Action</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Warn</Button>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="search-input">
                Quick Search
              </label>
              <Input id="search-input" placeholder="Search your library" className="max-w-md" />
            </div>
          </section>

          <section className="space-y-6 rounded-xl border border-border bg-surface-2 p-8 shadow-soft backdrop-blur-lg">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Sheet Overlay</h2>
              <p className="text-sm text-muted">
                Preferences write through immediately. Slider changes update the reader and persist to local storage.
              </p>
            </div>
            <SettingsSheet
              open={sheetOpen}
              onOpenChange={setSheetOpen}
              preferences={preferences}
              onPreferencesChange={setPreferences}
              keymap={keymap}
              trigger={<Button variant="outline">Open reader settings</Button>}
            />
          </section>

          <section className="space-y-6 rounded-xl border border-border bg-surface-2 p-8 shadow-soft backdrop-blur-lg">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Command Palette</h2>
              <p className="text-sm text-muted">Drop-in command menu with keyboard shortcut styling.</p>
            </div>
            <Command className="max-w-xl">
              <CommandInput placeholder="Filter frameworks..." />
              <CommandList>
                <CommandEmpty>No results found.</CommandEmpty>
                <CommandGroup heading="Stacks">
                  {frameworks.map((framework) => (
                    <CommandItem key={framework.value} value={framework.value}>
                      {framework.label}
                      <CommandShortcut>Ctrl+{framework.label.charAt(0)}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
                <CommandSeparator />
                <CommandGroup heading="Actions">
                  <CommandItem value="shortcuts">Open key bindings</CommandItem>
                  <CommandItem value="layout">Toggle layout mode</CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </section>

          <section className="space-y-6 rounded-xl border border-border bg-surface-2 p-8 shadow-soft backdrop-blur-lg">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Toast Notifications</h2>
              <p className="text-sm text-muted">Context hooks expose success, info, and error toasts.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button
                onClick={() =>
                  toast({
                    variant: 'success',
                    title: 'Progress saved',
                    description: 'Last page synced at ' + new Date().toLocaleTimeString()
                  })
                }
              >
                Save toast
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  toast({
                    variant: 'destructive',
                    title: 'Cache miss',
                    description: 'Decoding the next spread…'
                  })
                }
              >
                Error toast
              </Button>
            </div>
          </section>

          <section className="space-y-6 rounded-xl border border-border bg-surface-2 p-8 shadow-soft backdrop-blur-lg lg:col-span-2">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Reader Canvas</h2>
              <p className="text-sm text-muted">
                OffscreenCanvas progressively streams decoded bitmaps from the Tauri backend into the main
                reader viewport.
              </p>
            </div>
            <div
              ref={setReaderContainer}
              data-testid="reader-surface"
              className="relative h-[420px] overflow-hidden rounded-2xl border border-border bg-surface"
            >
              <ReaderViewport
                groups={pageGroups}
                activeGroupIndex={normalizedGroupIndex}
                readingLayout={readingLayout}
                readingDirection={readingDirection}
                fitMode={fitMode}
                zoom={zoom}
                rotation={rotation}
                minZoom={minZoom}
                maxZoom={maxZoom}
                zoomStep={zoomStep}
                onZoomChange={handleZoomChange}
              />
              {!hasPages ? (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
                  {loading ? 'Loading demo bundle…' : 'Load the demo bundle to render sample pages.'}
                </div>
              ) : null}
              <ReaderOverlay
                container={readerContainer}
                zoom={zoom}
                rotation={rotation}
                minZoom={minZoom}
                maxZoom={maxZoom}
                zoomStep={zoomStep}
                fitMode={fitMode}
                readingLayout={readingLayout}
                readingDirection={readingDirection}
                currentPage={currentPageNumber}
                currentPageLabel={currentPageLabel ?? undefined}
                totalPages={totalPages}
                onZoomChange={handleZoomChange}
                onZoomIn={handleZoomIn}
                onZoomOut={handleZoomOut}
                onFitModeChange={setFitMode}
                onReadingLayoutChange={setReadingLayout}
                onReadingDirectionToggle={handleReadingDirectionChange}
                onRotateClockwise={rotateClockwise}
                onRotateCounterClockwise={rotateCounterClockwise}
                onResetRotation={handleResetRotation}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text">Stats</span>
                <span className="tabular-nums">
                  Cache: {stats?.cachedPages ?? 0} pages · Pending prefetch: {stats?.pendingPrefetch ?? 0}
                </span>
                <span className="tabular-nums">
                  Budget: {preferences.cacheBudgetMb} MB · Window: ±{preferences.prefetchRadius} pages
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    void handleLoadDemo()
                  }}
                  disabled={loading}
                >
                  {loading ? 'Loading…' : 'Load demo bundle'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPages([])}>
                  Reset preview
                </Button>
              </div>
            </div>
          </section>
          </main>
        </div>
      </div>
      <Toaster />
      <CommandPalette
        pages={pages}
        activeIndex={activeIndex}
        fitMode={fitMode}
        readingLayout={readingLayout}
        readingDirection={readingDirection}
        rotation={rotation}
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onSelectPage={setActiveIndex}
        onFitModeChange={setFitMode}
        onReadingLayoutChange={setReadingLayout}
        onReadingDirectionChange={handleReadingDirectionChange}
        onRotateClockwise={rotateClockwise}
        onRotateCounterClockwise={rotateCounterClockwise}
        onResetRotation={handleResetRotation}
        onOpenLibrary={handleOpenLibrary}
        onOpenSettings={handleOpenSettingsSheet}
        shortcutForAction={shortcutForAction}
      />
    </div>
  )
}

export default App
