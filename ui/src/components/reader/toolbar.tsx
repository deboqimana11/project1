import * as React from 'react'
import * as ToolbarPrimitive from '@radix-ui/react-toolbar'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Command as CommandIcon,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  ZoomIn,
  ZoomOut
} from 'lucide-react'

import {
  DoublePageGlyph,
  FitContainGlyph,
  FitFillGlyph,
  FitHeightGlyph,
  FitOriginalGlyph,
  FitWidthGlyph,
  SinglePageGlyph,
  VerticalGlyph
} from './glyphs'

import type { FitMode } from '@/ipc'
import { READER_MAX_ZOOM, READER_MIN_ZOOM, READER_ZOOM_STEP, type Rotation } from './view-model'
import { cn } from '@/lib/utils'

export type ReadingLayout = 'single' | 'double' | 'vertical'
export type ReadingDirection = 'ltr' | 'rtl'

const DEFAULT_MIN_ZOOM = READER_MIN_ZOOM
const DEFAULT_MAX_ZOOM = READER_MAX_ZOOM
const DEFAULT_ZOOM_STEP = READER_ZOOM_STEP

interface ToolbarProps {
  sourceName?: string
  currentPage: number
  totalPages: number
  currentPageLabel?: string
  zoom: number
  rotation?: Rotation
  minZoom?: number
  maxZoom?: number
  zoomStep?: number
  fitMode: FitMode
  readingLayout: ReadingLayout
  readingDirection: ReadingDirection
  canNavigateBack?: boolean
  canNavigateForward?: boolean
  onNavigateBack?: () => void
  onNavigateForward?: () => void
  onOpenLibrary?: () => void
  onZoomChange?: (value: number) => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onFitModeChange?: (fit: FitMode) => void
  onReadingLayoutChange?: (layout: ReadingLayout) => void
  onReadingDirectionToggle?: (direction: ReadingDirection) => void
  onRotateClockwise?: () => void
  onRotateCounterClockwise?: () => void
  onResetRotation?: () => void
  onOpenSearch?: () => void
  onOpenCommandPalette?: () => void
  onOpenSettings?: () => void
}

export function Toolbar({
  sourceName,
  currentPage,
  totalPages,
  currentPageLabel,
  zoom,
  rotation = 0,
  minZoom = DEFAULT_MIN_ZOOM,
  maxZoom = DEFAULT_MAX_ZOOM,
  zoomStep = DEFAULT_ZOOM_STEP,
  fitMode,
  readingLayout,
  readingDirection,
  canNavigateBack = false,
  canNavigateForward = false,
  onNavigateBack,
  onNavigateForward,
  onOpenLibrary,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onFitModeChange,
  onReadingLayoutChange,
  onReadingDirectionToggle,
  onRotateClockwise,
  onRotateCounterClockwise,
  onResetRotation,
  onOpenSearch,
  onOpenCommandPalette,
  onOpenSettings
}: ToolbarProps) {
  const clampedZoom = React.useMemo(() => {
    if (!Number.isFinite(zoom)) return 1
    return Math.min(Math.max(zoom, minZoom), maxZoom)
  }, [zoom, minZoom, maxZoom])

  const zoomPercent = Math.round(clampedZoom * 100)

  const handleZoomIn = React.useCallback(() => {
    if (onZoomIn) {
      onZoomIn()
      return
    }
    if (onZoomChange) {
      const next = Math.min(clampedZoom + zoomStep, maxZoom)
      onZoomChange(Number(next.toFixed(3)))
    }
  }, [clampedZoom, maxZoom, onZoomChange, onZoomIn, zoomStep])

  const handleZoomOut = React.useCallback(() => {
    if (onZoomOut) {
      onZoomOut()
      return
    }
    if (onZoomChange) {
      const next = Math.max(clampedZoom - zoomStep, minZoom)
      onZoomChange(Number(next.toFixed(3)))
    }
  }, [clampedZoom, minZoom, onZoomChange, onZoomOut, zoomStep])

  const handleZoomSlider = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.target.value) / 100
      if (!Number.isFinite(value)) {
        return
      }
      onZoomChange?.(Number(value.toFixed(3)))
    },
    [onZoomChange]
  )

  const handleLayoutChange = React.useCallback(
    (value: string) => {
      if (value === '') {
        return
      }
      onReadingLayoutChange?.(value as ReadingLayout)
    },
    [onReadingLayoutChange]
  )

  const handleFitChange = React.useCallback(
    (value: string) => {
      if (value === '') {
        return
      }
      onFitModeChange?.(value as FitMode)
    },
    [onFitModeChange]
  )

  const toggleDirection = React.useCallback(() => {
    onReadingDirectionToggle?.(readingDirection === 'ltr' ? 'rtl' : 'ltr')
  }, [onReadingDirectionToggle, readingDirection])

  const pageLabel = React.useMemo(() => {
    if (!totalPages || totalPages <= 0) {
      return '— / —'
    }
    if (currentPageLabel && currentPageLabel.trim() !== '') {
      return `${currentPageLabel} / ${totalPages}`
    }
    const safeCurrent = Math.min(Math.max(currentPage, 1), totalPages)
    return `${safeCurrent} / ${totalPages}`
  }, [currentPage, currentPageLabel, totalPages])

  return (
    <ToolbarPrimitive.Root
      aria-label="Reader controls"
      className="sticky top-0 z-40 w-full border-b border-border bg-surface/90 backdrop-blur-md shadow-soft"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5 text-sm md:px-6">
        <div className="flex items-center gap-2">
          <ToolbarButton
            label="Back"
            icon={ArrowLeft}
            onClick={onNavigateBack}
            disabled={!canNavigateBack}
          />
          <ToolbarButton
            label="Forward"
            icon={ArrowRight}
            onClick={onNavigateForward}
            disabled={!canNavigateForward}
          />
          <ToolbarButton label="Import" icon={BookOpen} onClick={onOpenLibrary} />
          <ToolbarSeparator />
          <div className="hidden min-w-[160px] flex-col leading-tight text-muted sm:flex">
            <span className="text-xs uppercase tracking-[0.2em] text-muted">Now reading</span>
            <span data-testid="now-reading-source" className="truncate text-sm text-text">{sourceName ?? 'Untitled source'}</span>
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center gap-4">
          <ToolbarPrimitive.ToggleGroup
            type="single"
            value={readingLayout}
            onValueChange={handleLayoutChange}
            aria-label="Reading layout"
            className="flex items-center gap-1"
          >
            <ToolbarToggle value="single" label="Single page">
              <SinglePageGlyph />
            </ToolbarToggle>
            <ToolbarToggle value="double" label="Double page">
              <DoublePageGlyph />
            </ToolbarToggle>
            <ToolbarToggle value="vertical" label="Long strip">
              <VerticalGlyph />
            </ToolbarToggle>
          </ToolbarPrimitive.ToggleGroup>

          <ToolbarSeparator />

          <ToolbarPrimitive.ToggleGroup
            type="single"
            value={fitMode}
            onValueChange={handleFitChange}
            aria-label="Fit mode"
            className="hidden items-center gap-1 md:flex"
          >
            <ToolbarToggle value="fitWidth" label="Fit width">
              <FitWidthGlyph />
            </ToolbarToggle>
            <ToolbarToggle value="fitHeight" label="Fit height">
              <FitHeightGlyph />
            </ToolbarToggle>
            <ToolbarToggle value="fitContain" label="Contain">
              <FitContainGlyph />
            </ToolbarToggle>
            <ToolbarToggle value="fill" label="Fill">
              <FitFillGlyph />
            </ToolbarToggle>
            <ToolbarToggle value="original" label="Original size">
              <FitOriginalGlyph />
            </ToolbarToggle>
          </ToolbarPrimitive.ToggleGroup>

          <ToolbarSeparator className="hidden md:block" />

          <div className="flex items-center gap-2">
            <ToolbarButton label="Zoom out" icon={ZoomOut} onClick={handleZoomOut} />
            <label className="group flex items-center gap-2" aria-label="Zoom slider">
              <input
                type="range"
                min={Math.round(minZoom * 100)}
                max={Math.round(maxZoom * 100)}
                step={Math.round(zoomStep * 100)}
                value={zoomPercent}
                onChange={handleZoomSlider}
                className="h-[4px] w-28 cursor-pointer appearance-none rounded-full bg-border/60 transition-colors group-hover:bg-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              />
              <span className="tabular-nums text-xs text-muted">{zoomPercent}%</span>
            </label>
            <ToolbarButton label="Zoom in" icon={ZoomIn} onClick={handleZoomIn} />
          </div>

          <ToolbarSeparator className="hidden lg:block" />

          <div className="hidden items-center gap-2 lg:flex">
            <ToolbarButton label="Rotate counter-clockwise" icon={RotateCcw} onClick={onRotateCounterClockwise} disabled={!onRotateCounterClockwise} />
            <ToolbarButton label="Rotate clockwise" icon={RotateCw} onClick={onRotateClockwise} disabled={!onRotateClockwise} />
            <ToolbarButton label="Reset rotation" onClick={onResetRotation} disabled={!onResetRotation}>
              <span className="text-xs font-medium uppercase tracking-[0.2em] text-muted">{rotation}°</span>
            </ToolbarButton>
          </div>

          <ToolbarSeparator className="hidden xl:block" />

          <ToolbarButton
            label={readingDirection === 'ltr' ? 'Left-to-right' : 'Right-to-left'}
            onClick={toggleDirection}
          >
            <span className="text-xs font-medium uppercase tracking-[0.3em] text-muted">
              {readingDirection === 'ltr' ? 'LTR' : 'RTL'}
            </span>
          </ToolbarButton>
        </div>

        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-2 text-xs text-muted md:flex">
            <span className="tabular-nums text-sm text-text">{pageLabel}</span>
          </div>
          <ToolbarSeparator className="hidden md:block" />
          <ToolbarButton label="Search" icon={Search} onClick={onOpenSearch} />
          <ToolbarButton label="Command palette" icon={CommandIcon} onClick={onOpenCommandPalette}>
            <span className="text-[0.65rem] uppercase tracking-[0.35em] text-muted">⌘K</span>
          </ToolbarButton>
          <ToolbarButton label="Settings" icon={Settings} onClick={onOpenSettings} />
        </div>
      </div>
    </ToolbarPrimitive.Root>
  )
}

interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>
  children?: React.ReactNode
}

function ToolbarButton({ label, icon: Icon, children, className, ...rest }: ToolbarButtonProps) {
  return (
    <ToolbarPrimitive.Button asChild>
      <button
        type="button"
        aria-label={label}
        className={cn(
          'group inline-flex h-10 min-w-10 items-center justify-center gap-2 rounded-md border border-border/60 bg-surface px-3 text-xs font-medium uppercase tracking-[0.2em] text-muted transition-all duration-fast ease-elegant hover:border-accent/40 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[.98]',
          className
        )}
        {...rest}
      >
        {Icon ? <Icon className="h-4 w-4" aria-hidden /> : null}
        {children}
      </button>
    </ToolbarPrimitive.Button>
  )
}

interface ToolbarToggleProps {
  value: string
  label: string
  children: React.ReactNode
}

function ToolbarToggle({ value, label, children }: ToolbarToggleProps) {
  return (
    <ToolbarPrimitive.ToggleItem
      value={value}
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-10 items-center justify-center rounded-md border border-transparent text-muted transition-all duration-fast ease-elegant hover:border-accent/50 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg data-[state=on]:border-accent data-[state=on]:bg-surface data-[state=on]:text-text'
      )}
    >
      <span aria-hidden className="flex h-5 w-5 items-center justify-center text-current">
        {children}
      </span>
    </ToolbarPrimitive.ToggleItem>
  )
}

function ToolbarSeparator({ className }: { className?: string }) {
  return <ToolbarPrimitive.Separator className={cn('h-6 w-px bg-border/70', className)} />
}
