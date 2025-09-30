import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PanelsTopLeft, RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react'

import type { FitMode } from '@/ipc'
import { cn } from '@/lib/utils'

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
import { READER_MAX_ZOOM, READER_MIN_ZOOM, READER_ZOOM_STEP, type Rotation } from './view-model'
import type { ReadingDirection, ReadingLayout } from './toolbar'

const DEFAULT_AUTO_HIDE_MS = 3000
const DEFAULT_EDGE_DISTANCE = 144
const DEFAULT_MIN_ZOOM = READER_MIN_ZOOM
const DEFAULT_MAX_ZOOM = READER_MAX_ZOOM
const DEFAULT_ZOOM_STEP = READER_ZOOM_STEP

interface ReaderOverlayProps {
  container: HTMLElement | null
  zoom: number
  minZoom?: number
  maxZoom?: number
  zoomStep?: number
  rotation: Rotation
  fitMode: FitMode
  readingLayout: ReadingLayout
  readingDirection: ReadingDirection
  currentPage?: number
  currentPageLabel?: string
  totalPages?: number
  autoHideMs?: number
  edgeDistance?: number
  className?: string
  onZoomChange?: (value: number) => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onFitModeChange?: (value: FitMode) => void
  onReadingLayoutChange?: (value: ReadingLayout) => void
  onReadingDirectionToggle?: (value: ReadingDirection) => void
  onRotateClockwise?: () => void
  onRotateCounterClockwise?: () => void
  onResetRotation?: () => void
  onVisibilityChange?: (visible: boolean) => void
}

export function ReaderOverlay({
  container,
  zoom,
  minZoom = DEFAULT_MIN_ZOOM,
  maxZoom = DEFAULT_MAX_ZOOM,
  zoomStep = DEFAULT_ZOOM_STEP,
  rotation,
  fitMode,
  readingLayout,
  readingDirection,
  currentPage,
  totalPages,
  currentPageLabel,
  autoHideMs = DEFAULT_AUTO_HIDE_MS,
  edgeDistance = DEFAULT_EDGE_DISTANCE,
  className,
  onZoomChange,
  onZoomIn,
  onZoomOut,
  onFitModeChange,
  onReadingLayoutChange,
  onReadingDirectionToggle,
  onRotateClockwise,
  onRotateCounterClockwise,
  onResetRotation,
  onVisibilityChange
}: ReaderOverlayProps) {
  const [visible, setVisible] = React.useState(true)
  const overlayRef = React.useRef<HTMLDivElement | null>(null)
  const hideTimeoutRef = React.useRef<number | null>(null)
  const interactingRef = React.useRef(false)

  const setVisibility = React.useCallback(
    (next: boolean) => {
      setVisible((prev) => {
        if (prev === next) {
          return prev
        }
        onVisibilityChange?.(next)
        return next
      })
    },
    [onVisibilityChange]
  )

  const clearHideTimeout = React.useCallback(() => {
    if (hideTimeoutRef.current !== null) {
      window.clearTimeout(hideTimeoutRef.current)
      hideTimeoutRef.current = null
    }
  }, [])

  // Track idle state so the overlay auto-hides after a short delay without input.
  const queueHide = React.useCallback(
    (delayMs?: number) => {
      if (autoHideMs <= 0) {
        return
      }
      clearHideTimeout()
      hideTimeoutRef.current = window.setTimeout(() => {
        if (!interactingRef.current) {
          setVisibility(false)
        }
      }, delayMs ?? autoHideMs)
    },
    [autoHideMs, clearHideTimeout, setVisibility]
  )

  const reveal = React.useCallback(() => {
    setVisibility(true)
    queueHide()
  }, [queueHide, setVisibility])

  const setInteracting = React.useCallback(
    (next: boolean) => {
      interactingRef.current = next
      if (next) {
        clearHideTimeout()
        setVisibility(true)
      } else {
        queueHide()
      }
    },
    [clearHideTimeout, queueHide, setVisibility]
  )

  // Reveal the overlay when users approach the bottom edge, scroll, or focus inside the reader.
  React.useEffect(() => {
    if (!container) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect()
      if (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      ) {
        const distanceFromBottom = rect.bottom - event.clientY
        if (distanceFromBottom <= edgeDistance) {
          reveal()
        }
      }
    }

    const handleWheel = () => {
      reveal()
    }

    const handleFocusIn = (event: FocusEvent) => {
      if (container.contains(event.target as Node)) {
        reveal()
      }
    }

    const handlePointerLeave = () => {
      queueHide()
    }

    container.addEventListener('pointermove', handlePointerMove, { passive: true })
    container.addEventListener('pointerdown', handlePointerMove, { passive: true })
    container.addEventListener('wheel', handleWheel, { passive: true })
    container.addEventListener('focusin', handleFocusIn)
    container.addEventListener('pointerleave', handlePointerLeave)

    return () => {
      container.removeEventListener('pointermove', handlePointerMove)
      container.removeEventListener('pointerdown', handlePointerMove)
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('focusin', handleFocusIn)
      container.removeEventListener('pointerleave', handlePointerLeave)
    }
  }, [container, edgeDistance, queueHide, reveal])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.key === 'Tab' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'PageUp' ||
        event.key === 'PageDown' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        reveal()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [reveal])

  React.useEffect(() => {
    queueHide(autoHideMs)
    return () => {
      clearHideTimeout()
    }
  }, [autoHideMs, clearHideTimeout, queueHide])

  const clampedZoom = React.useMemo(() => {
    if (!Number.isFinite(zoom)) {
      return 1
    }
    return Math.min(Math.max(zoom, minZoom), maxZoom)
  }, [zoom, minZoom, maxZoom])

  const zoomPercent = Math.round(clampedZoom * 100)

  const pageSummary = React.useMemo(() => {
    if (!totalPages || totalPages <= 0) {
      return '— / —'
    }
    if (currentPageLabel && currentPageLabel.trim() !== '') {
      return `${currentPageLabel} / ${totalPages}`
    }
    if (!currentPage || Number.isNaN(currentPage)) {
      return `— / ${totalPages}`
    }
    const safeCurrent = Math.min(Math.max(Math.round(currentPage), 1), totalPages)
    return `${safeCurrent} / ${totalPages}`
  }, [currentPage, currentPageLabel, totalPages])

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

  const layoutOptions = React.useMemo(
    () => [
      { value: 'single' as ReadingLayout, label: 'Single page', icon: <SinglePageGlyph /> },
      { value: 'double' as ReadingLayout, label: 'Double page', icon: <DoublePageGlyph /> },
      { value: 'vertical' as ReadingLayout, label: 'Long strip', icon: <VerticalGlyph /> }
    ],
    []
  )

  const fitOptions = React.useMemo(
    () => [
      { value: 'fitWidth' as FitMode, label: 'Fit width', icon: <FitWidthGlyph /> },
      { value: 'fitHeight' as FitMode, label: 'Fit height', icon: <FitHeightGlyph /> },
      { value: 'fitContain' as FitMode, label: 'Contain', icon: <FitContainGlyph /> },
      { value: 'fill' as FitMode, label: 'Fill', icon: <FitFillGlyph /> },
      { value: 'original' as FitMode, label: 'Original', icon: <FitOriginalGlyph /> }
    ],
    []
  )

  return (
    <AnimatePresence initial={false}>
      {visible ? (
        <motion.div
          ref={overlayRef}
          role="region"
          aria-label="Floating reader controls"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
          onPointerEnter={() => setInteracting(true)}
          onPointerLeave={() => setInteracting(false)}
          onFocusCapture={() => setInteracting(true)}
          onBlurCapture={(event) => {
            const nextTarget = event.relatedTarget
            if (overlayRef.current && nextTarget instanceof Node && overlayRef.current.contains(nextTarget)) {
              return
            }
            setInteracting(false)
          }}
          className={cn(
            'pointer-events-auto absolute bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-2xl border border-border/70 bg-surface-2/95 px-4 py-3 shadow-soft backdrop-blur-lg',
            'flex min-w-[320px] items-center gap-4 text-xs text-muted',
            className
          )}
        >
         <div className="flex items-center gap-2">
            <OverlayIconButton
              label="Zoom out"
              onClick={handleZoomOut}
              disabled={!onZoomChange && !onZoomOut}
            >
              <ZoomOut className="h-4 w-4" aria-hidden />
            </OverlayIconButton>
            <label className="flex items-center gap-2" aria-label="Zoom slider">
              <input
                type="range"
                min={Math.round(minZoom * 100)}
                max={Math.round(maxZoom * 100)}
                step={Math.round(zoomStep * 100)}
                value={zoomPercent}
                onChange={handleZoomSlider}
                disabled={!onZoomChange}
                className="h-[4px] w-28 cursor-pointer appearance-none rounded-full bg-border/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              />
              <span className="tabular-nums text-[0.7rem] text-muted">{zoomPercent}%</span>
            </label>
            <OverlayIconButton
              label="Zoom in"
              onClick={handleZoomIn}
              disabled={!onZoomChange && !onZoomIn}
            >
              <ZoomIn className="h-4 w-4" aria-hidden />
            </OverlayIconButton>
          </div>

          <div className="hidden items-center gap-1 sm:flex">
            {layoutOptions.map((option) => (
              <OverlayToggle
                key={option.value}
                pressed={readingLayout === option.value}
                label={option.label}
                disabled={!onReadingLayoutChange}
                onClick={() => onReadingLayoutChange?.(option.value)}
              >
                {option.icon}
              </OverlayToggle>
            ))}
          </div>

          <div className="hidden items-center gap-1 md:flex">
            {fitOptions.map((option) => (
              <OverlayToggle
                key={option.value}
                pressed={fitMode === option.value}
                label={option.label}
                disabled={!onFitModeChange}
                onClick={() => onFitModeChange?.(option.value)}
              >
                {option.icon}
              </OverlayToggle>
            ))}
          </div>

          <div className="hidden items-center gap-1 lg:flex">
            <OverlayIconButton label="Rotate counter-clockwise" onClick={onRotateCounterClockwise} disabled={!onRotateCounterClockwise}>
              <RotateCcw className="h-4 w-4" aria-hidden />
            </OverlayIconButton>
            <OverlayIconButton label="Rotate clockwise" onClick={onRotateClockwise} disabled={!onRotateClockwise}>
              <RotateCw className="h-4 w-4" aria-hidden />
            </OverlayIconButton>
            <OverlayToggle
              pressed={rotation !== 0}
              label="Reset rotation"
              disabled={!onResetRotation}
              onClick={() => onResetRotation?.()}
            >
              <span className="text-[0.7rem] font-medium uppercase tracking-[0.25em] text-muted">{rotation}°</span>
            </OverlayToggle>
          </div>

          <OverlayIconButton
            label={readingDirection === 'ltr' ? 'Switch to right-to-left' : 'Switch to left-to-right'}
            disabled={!onReadingDirectionToggle}
            onClick={() => onReadingDirectionToggle?.(readingDirection === 'ltr' ? 'rtl' : 'ltr')}
          >
            <span className="text-[0.65rem] font-medium uppercase tracking-[0.35em] text-muted">
              {readingDirection === 'ltr' ? 'LTR' : 'RTL'}
            </span>
          </OverlayIconButton>

          <div className="ml-auto hidden items-center gap-2 text-[0.65rem] uppercase tracking-[0.3em] text-muted lg:flex">
            <PanelsTopLeft className="h-4 w-4" aria-hidden />
            <span className="tabular-nums text-text">{pageSummary}</span>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

interface OverlayIconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
}

function OverlayIconButton({ label, className, children, ...props }: OverlayIconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent bg-surface/60 text-muted transition-all duration-fast ease-elegant hover:border-accent/50 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[.98] disabled:pointer-events-none disabled:opacity-50',
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}

interface OverlayToggleProps {
  pressed: boolean
  label: string
  children: React.ReactNode
  disabled?: boolean
  onClick?: () => void
}

function OverlayToggle({ pressed, label, children, onClick, disabled }: OverlayToggleProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-transparent text-muted transition-all duration-fast ease-elegant hover:border-accent/50 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[.98] disabled:pointer-events-none disabled:opacity-60',
        pressed ? 'border-accent bg-surface text-text shadow-soft' : 'bg-surface/60'
      )}
    >
      <span aria-hidden className="flex h-5 w-5 items-center justify-center text-current">
        {children}
      </span>
    </button>
  )
}
