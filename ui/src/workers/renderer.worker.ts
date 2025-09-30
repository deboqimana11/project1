/// <reference lib="webworker" />

interface InitMessage {
  type: 'init'
  canvas: OffscreenCanvas
}

interface SetBitmapMessage {
  type: 'set-bitmap'
  bitmap: ImageBitmap
  width: number
  height: number
}

interface RenderMessage {
  type: 'render'
  viewportWidth: number
  viewportHeight: number
  baseScale: number
  scale: number
  offset: { x: number; y: number }
  rotation: number
  devicePixelRatio: number
}

interface ClearMessage {
  type: 'clear'
}

interface DisposeMessage {
  type: 'dispose'
}

interface LogMessage {
  type: 'log'
  payload: unknown
}

type IncomingMessage =
  | InitMessage
  | SetBitmapMessage
  | RenderMessage
  | ClearMessage
  | DisposeMessage
  | LogMessage

declare const self: DedicatedWorkerGlobalScope

let canvas: OffscreenCanvas | null = null
let context: OffscreenCanvasRenderingContext2D | null = null
let currentBitmap: ImageBitmap | null = null
let imageWidth = 0
let imageHeight = 0
let lastViewportWidth = 0
let lastViewportHeight = 0

function ensureCanvasSize(width: number, height: number, devicePixelRatio: number) {
  if (!canvas) {
    return
  }
  const dpr = devicePixelRatio || 1
  const targetWidth = Math.max(1, Math.floor(width * dpr))
  const targetHeight = Math.max(1, Math.floor(height * dpr))
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth
    canvas.height = targetHeight
  }
}

function clearSurface() {
  if (!context) {
    return
  }
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, lastViewportWidth, lastViewportHeight)
}

function performRender(params: RenderMessage) {
  const { viewportWidth, viewportHeight, baseScale, scale, offset, rotation, devicePixelRatio } = params
  lastViewportWidth = viewportWidth
  lastViewportHeight = viewportHeight

  if (!context) {
    return
  }

  ensureCanvasSize(viewportWidth, viewportHeight, devicePixelRatio)

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0)
  context.clearRect(0, 0, viewportWidth, viewportHeight)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  if (!currentBitmap || imageWidth === 0 || imageHeight === 0) {
    return
  }

  const totalScale = baseScale * scale
  const drawWidth = imageWidth * totalScale
  const drawHeight = imageHeight * totalScale
  const viewportCenterX = viewportWidth / 2
  const viewportCenterY = viewportHeight / 2
  const centerX = viewportCenterX + offset.x
  const centerY = viewportCenterY + offset.y
  const rotationRadians = ((rotation % 360) * Math.PI) / 180

  context.save()
  context.translate(centerX, centerY)
  if (rotationRadians !== 0) {
    context.rotate(rotationRadians)
  }
  context.drawImage(currentBitmap, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
  context.restore()
}

function disposeBitmap() {
  if (currentBitmap) {
    currentBitmap.close()
    currentBitmap = null
    imageWidth = 0
    imageHeight = 0
  }
}

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data
  switch (message.type) {
    case 'init': {
      canvas = message.canvas
      context = canvas.getContext('2d')
      if (!context) {
        self.postMessage({ type: 'log', payload: 'Failed to acquire OffscreenCanvasRenderingContext2D' })
      }
      break
    }
    case 'set-bitmap': {
      disposeBitmap()
      currentBitmap = message.bitmap
      imageWidth = message.width
      imageHeight = message.height
      break
    }
    case 'render': {
      performRender(message)
      break
    }
    case 'clear': {
      disposeBitmap()
      clearSurface()
      break
    }
    case 'dispose': {
      disposeBitmap()
      context = null
      canvas = null
      break
    }
    case 'log': {
      console.log('[ReaderWorker]', message.payload)
      break
    }
    default: {
      throw new Error('Unsupported worker message')
    }
  }
}

self.onmessageerror = (event) => {
  console.error('Reader worker message error', event)
}
