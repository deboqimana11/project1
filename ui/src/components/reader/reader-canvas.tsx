import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'

import type { FitMode, PageMeta } from '@/ipc'
import { buildRenderParams, getPageUrl } from '@/ipc'
import { cn } from '@/lib/utils'

import { READER_MAX_ZOOM, READER_MIN_ZOOM, READER_ZOOM_STEP, type Rotation } from './view-model'

interface ReaderCanvasProps {
  page: PageMeta | null
  className?: string
  fitMode: FitMode
  zoom: number
  rotation: Rotation
  minZoom?: number
  maxZoom?: number
  zoomStep?: number
  onZoomChange?: (value: number) => void
}

interface Size {
  width: number
  height: number
}

interface Offset {
  x: number
  y: number
}

const defaultOffset: Offset = { x: 0, y: 0 }

export function ReaderCanvas({
  page,
  className,
  fitMode,
  zoom,
  rotation,
  minZoom = READER_MIN_ZOOM,
  maxZoom = READER_MAX_ZOOM,
  zoomStep = READER_ZOOM_STEP,
  onZoomChange
}: ReaderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const frameRef = useRef<number | null>(null)
  const panSession = useRef<{
    pointerId: number
    startX: number
    startY: number
    originOffset: Offset
  } | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const previousBitmap = useRef<ImageBitmap | null>(null)

  const [containerSize, setContainerSize] = useState<Size>({ width: 0, height: 0 })
  const [imageSize, setImageSize] = useState<Size>({ width: 0, height: 0 })
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [offset, setOffset] = useState<Offset>(defaultOffset)
  const [isPanning, setIsPanning] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supportsOffscreen = useMemo(() => {
    return (
      typeof window !== 'undefined' &&
      typeof Worker !== 'undefined' &&
      'OffscreenCanvas' in window &&
      'transferControlToOffscreen' in HTMLCanvasElement.prototype
    )
  }, [])

  const [workerReady, setWorkerReady] = useState(false)
  const [offscreenEnabled, setOffscreenEnabled] = useState(true)
  const [canvasKey, setCanvasKey] = useState(0)

  const shouldUseWorker = supportsOffscreen && offscreenEnabled

  useLayoutEffect(() => {
    const node = containerRef.current
    if (!node) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === node) {
          const box = entry.contentRect
          setContainerSize({ width: box.width, height: box.height })
        }
      }
    })

    observer.observe(node)

    return () => {
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
      }
      previousBitmap.current?.close()
      previousBitmap.current = null
      if (workerRef.current) {
        workerRef.current.postMessage({ type: 'dispose' })
        workerRef.current.terminate()
        workerRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!shouldUseWorker) {
      setWorkerReady((ready) => (ready ? false : ready))
      return
    }

    const canvas = canvasRef.current
    if (!canvas) {
      return
    }

    if ((canvas as unknown as { __offscreenTransferred?: boolean }).__offscreenTransferred) {
      setOffscreenEnabled(false)
      setCanvasKey((value) => value + 1)
      workerRef.current = null
      setWorkerReady((ready) => (ready ? false : ready))
      return
    }

    let offscreen: OffscreenCanvas
    try {
      offscreen = canvas.transferControlToOffscreen()
    } catch (error) {
      console.warn('Falling back to main-thread rendering: failed to transfer control to OffscreenCanvas.', error)
      setOffscreenEnabled(false)
      setCanvasKey((value) => value + 1)
      workerRef.current = null
      setWorkerReady((ready) => (ready ? false : ready))
      return
    }

    const worker = new Worker(new URL('../../workers/renderer.worker.ts', import.meta.url), {
      type: 'module'
    })
    workerRef.current = worker
    ;(canvas as unknown as { __offscreenTransferred?: boolean }).__offscreenTransferred = true
    worker.postMessage({ type: 'init', canvas: offscreen }, [offscreen])
    worker.onmessage = (event: MessageEvent<{ type?: string; payload?: unknown }>) => {
      const { type, payload } = event.data ?? {}
      if (type === 'log') {
        console.debug(payload)
      }
    }
    worker.onerror = (event) => {
      console.error('Reader worker error', event)
    }
    worker.onmessageerror = (event) => {
      console.error('Reader worker message error', event)
    }

    setWorkerReady(true)

    return () => {
      worker.postMessage({ type: 'dispose' })
      worker.terminate()
      workerRef.current = null
      setWorkerReady(false)
    }
  }, [shouldUseWorker])

  useEffect(() => {
    setOffset(defaultOffset)
  }, [page?.id.sourceId, page?.id.index, fitMode, rotation])

  useEffect(() => {
    if (!page || containerSize.width === 0 || containerSize.height === 0) {
      setBitmap(null)
      setImageSize({ width: 0, height: 0 })
      if (workerReady && workerRef.current) {
        workerRef.current.postMessage({ type: 'clear' })
      }
      return
    }

    let disposed = false
    const controller = new AbortController()

    setIsLoading(true)
    setError(null)

    const load = async () => {
      try {
        const params = buildRenderParams({
          fit: fitMode,
          viewportW: Math.round(containerSize.width),
          viewportH: Math.round(containerSize.height),
          scale: zoom,
          rotation
        })
        const url = await getPageUrl(page.id, params)
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`Failed to load image: ${response.status}`)
        }
        const blob = await response.blob()
        const nextBitmap = await createImageBitmap(blob)

        if (disposed) {
          nextBitmap.close()
          return
        }

        const intrinsicSize = { width: nextBitmap.width, height: nextBitmap.height }
        setImageSize(intrinsicSize)

        if (workerReady && workerRef.current) {
          workerRef.current.postMessage(
            { type: 'set-bitmap', bitmap: nextBitmap, width: intrinsicSize.width, height: intrinsicSize.height },
            [nextBitmap]
          )
          setBitmap(null)
          previousBitmap.current?.close()
          previousBitmap.current = null
        } else {
          previousBitmap.current?.close()
          previousBitmap.current = nextBitmap
          setBitmap(nextBitmap)
        }
      } catch (err) {
        if (disposed) {
          return
        }
        if ((err as Error).name === 'AbortError') {
          return
        }
        console.error('Failed to load page bitmap', err)
        setError((err as Error).message ?? 'Failed to load image')
        setBitmap(null)
        setImageSize({ width: 0, height: 0 })
        if (workerReady && workerRef.current) {
          workerRef.current.postMessage({ type: 'clear' })
        }
      } finally {
        if (!disposed) {
          setIsLoading(false)
        }
      }
    }

    void load()

    return () => {
      disposed = true
      controller.abort()
    }
  }, [page, containerSize.width, containerSize.height, workerReady, fitMode, rotation, zoom])

  const naturalSize = useMemo<Size>(() => {
    if (imageSize.width > 0 && imageSize.height > 0) {
      return imageSize
    }
    if (page) {
      return { width: page.width || 1, height: page.height || 1 }
    }
    return { width: 1, height: 1 }
  }, [imageSize, page])

  const rotatedNaturalSize = useMemo<Size>(() => {
    if (rotation % 180 === 0) {
      return naturalSize
    }
    return { width: naturalSize.height, height: naturalSize.width }
  }, [naturalSize, rotation])

  const baseScale = useMemo(() => {
    if (containerSize.width === 0 || containerSize.height === 0) {
      return 1
    }
    const { width: viewportW, height: viewportH } = containerSize
    const { width: contentW, height: contentH } = rotatedNaturalSize
    if (contentW <= 0 || contentH <= 0) {
      return 1
    }
    const widthRatio = viewportW / contentW
    const heightRatio = viewportH / contentH
    switch (fitMode) {
      case 'fitWidth':
        return widthRatio
      case 'fitHeight':
        return heightRatio
      case 'fill':
        return Math.max(widthRatio, heightRatio)
      case 'original':
        return 1
      case 'fitContain':
      default:
        return Math.min(widthRatio, heightRatio)
    }
  }, [containerSize, fitMode, rotatedNaturalSize])

  const scheduleRender = useCallback(() => {
    if (workerReady && workerRef.current) {
      if (containerSize.width === 0 || containerSize.height === 0) {
        return
      }
      workerRef.current.postMessage({
        type: 'render',
        viewportWidth: containerSize.width,
        viewportHeight: containerSize.height,
        baseScale,
        scale: zoom,
        offset,
        rotation,
        devicePixelRatio: window.devicePixelRatio || 1
      })
      return
    }

    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
    }
    frameRef.current = requestAnimationFrame(() => {
      const canvas = canvasRef.current
      const image = bitmap
      if (!canvas || !image) {
        let context: CanvasRenderingContext2D | null = null
        try {
          context = canvas?.getContext?.('2d') ?? null
        } catch (err) {
          console.debug('Unable to reset canvas context after offscreen transfer.', err)
        }
        if (context) {
          context.setTransform(1, 0, 0, 1, 0, 0)
          context.clearRect(0, 0, canvas.width, canvas.height)
        }
        return
      }

      const displayWidth = containerSize.width
      const displayHeight = containerSize.height
      if (displayWidth === 0 || displayHeight === 0) {
        return
      }

      const dpr = window.devicePixelRatio || 1
      const targetWidth = Math.max(1, Math.floor(displayWidth * dpr))
      const targetHeight = Math.max(1, Math.floor(displayHeight * dpr))

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth
        canvas.height = targetHeight
      }

      let context: CanvasRenderingContext2D | null = null
      try {
        context = canvas.getContext('2d')
      } catch (err) {
        console.debug('Unable to acquire 2D context; likely awaiting canvas reset.', err)
        return
      }
      if (!context) {
        return
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.clearRect(0, 0, displayWidth, displayHeight)
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'

      const drawScale = baseScale * zoom
      const drawWidth = image.width * drawScale
      const drawHeight = image.height * drawScale
      const viewportCenterX = displayWidth / 2
      const viewportCenterY = displayHeight / 2
      const centerX = viewportCenterX + offset.x
      const centerY = viewportCenterY + offset.y
      const rotationRadians = ((rotation % 360) * Math.PI) / 180

      context.save()
      context.translate(centerX, centerY)
      if (rotationRadians !== 0) {
        context.rotate(rotationRadians)
      }
      context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
      context.restore()
    })
  }, [workerReady, containerSize.width, containerSize.height, baseScale, zoom, offset, rotation, bitmap])

  useEffect(() => {
    scheduleRender()
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
      }
    }
  }, [scheduleRender])

  const clampScale = useCallback(
    (value: number) => {
      if (!Number.isFinite(value)) {
        return zoom
      }
      return Math.min(maxZoom, Math.max(minZoom, Number(value.toFixed(4))))
    },
    [maxZoom, minZoom, zoom]
  )

  const adjustOffsetForZoom = useCallback(
    (nextZoom: number, focalPoint: { x: number; y: number }) => {
      if (
        containerSize.width === 0 ||
        containerSize.height === 0 ||
        imageSize.width === 0 ||
        imageSize.height === 0
      ) {
        return defaultOffset
      }
      const viewportCenterX = containerSize.width / 2
      const viewportCenterY = containerSize.height / 2
      const currentScale = baseScale * zoom
      const targetScale = baseScale * nextZoom
      if (currentScale <= 0 || targetScale <= 0) {
        return offset
      }

      const rotationRadians = ((rotation % 360) * Math.PI) / 180
      const cos = Math.cos(rotationRadians)
      const sin = Math.sin(rotationRadians)

      const centerX = viewportCenterX + offset.x
      const centerY = viewportCenterY + offset.y

      const dx = focalPoint.x - centerX
      const dy = focalPoint.y - centerY

      const invCos = cos
      const invSin = -sin

      const rotatedX = dx * invCos - dy * invSin
      const rotatedY = dx * invSin + dy * invCos

      const scaleRatio = targetScale / currentScale

      const nextRotatedX = rotatedX * scaleRatio
      const nextRotatedY = rotatedY * scaleRatio

      const nextDx = nextRotatedX * cos - nextRotatedY * sin
      const nextDy = nextRotatedX * sin + nextRotatedY * cos

      const nextCenterX = focalPoint.x - nextDx
      const nextCenterY = focalPoint.y - nextDy

      return {
        x: nextCenterX - viewportCenterX,
        y: nextCenterY - viewportCenterY
      }
    },
    [baseScale, containerSize.height, containerSize.width, imageSize.height, imageSize.width, offset, rotation, zoom]
  )

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLCanvasElement>) => {
      if (imageSize.width === 0 || imageSize.height === 0) {
        return
      }
      event.preventDefault()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }

      const delta = Math.sign(event.deltaY)
      const factor = 1 + zoomStep
      const proposedScale = delta > 0 ? zoom / factor : zoom * factor
      const nextScale = clampScale(proposedScale)
      if (Math.abs(nextScale - zoom) < 0.0001) {
        return
      }

      const pointer = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      }
      const nextOffset = adjustOffsetForZoom(nextScale, pointer)
      setOffset(nextOffset)
      onZoomChange?.(nextScale)
    },
    [adjustOffsetForZoom, clampScale, imageSize.height, imageSize.width, onZoomChange, zoom, zoomStep]
  )

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 || imageSize.width === 0 || imageSize.height === 0) {
      return
    }
    const canvas = canvasRef.current
    if (!canvas) {
      return
    }
    canvas.setPointerCapture(event.pointerId)
    panSession.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originOffset: { ...offset }
    }
    setIsPanning(true)
  }, [offset, imageSize.width, imageSize.height])

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const session = panSession.current
    if (!session || session.pointerId !== event.pointerId) {
      return
    }
    const dx = event.clientX - session.startX
    const dy = event.clientY - session.startY
    setOffset({ x: session.originOffset.x + dx, y: session.originOffset.y + dy })
  }, [])

  const endPan = useCallback(() => {
    const canvas = canvasRef.current
    if (panSession.current && canvas) {
      canvas.releasePointerCapture(panSession.current.pointerId)
    }
    panSession.current = null
    setIsPanning(false)
  }, [])

  const hasImage = imageSize.width > 0 && imageSize.height > 0

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative flex h-full w-full select-none items-center justify-center overflow-hidden rounded-xl border border-border bg-surface text-muted',
        className
      )}
    >
      <canvas
        key={canvasKey}
        ref={canvasRef}
        className={cn('h-full w-full touch-none', isPanning ? 'cursor-grabbing' : 'cursor-grab')}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPan}
        onPointerCancel={endPan}
        onPointerLeave={endPan}
        onContextMenu={(event) => event.preventDefault()}
      />

      {(!page || !hasImage) && !isLoading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm">
          Select a page to begin reading
        </div>
      )}

      {isLoading && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface/90 px-3 py-1 text-xs uppercase tracking-[0.3em]">
          Loading…
        </div>
      )}

      {error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-sm text-danger">
          {error}
        </div>
      )}

      {hasImage && (
        <div className="pointer-events-none absolute right-4 top-4 rounded-full border border-border bg-surface/90 px-3 py-1 text-xs">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  )
}

export default ReaderCanvas
