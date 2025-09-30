import { useCallback, useMemo, useReducer } from 'react'

import type { FitMode } from '@/ipc'

export type Rotation = 0 | 90 | 180 | 270

export const READER_MIN_ZOOM = 0.5
export const READER_MAX_ZOOM = 3
export const READER_ZOOM_STEP = 0.12

interface ReaderViewState {
  fitMode: FitMode
  zoom: number
  rotation: Rotation
}

type ReaderViewAction =
  | { type: 'set-fit-mode'; fitMode: FitMode }
  | { type: 'set-zoom'; zoom: number }
  | { type: 'zoom-delta'; delta: number }
  | { type: 'set-rotation'; rotation: Rotation }
  | { type: 'rotate'; direction: 'cw' | 'ccw' }
  | { type: 'reset-view' }

const INITIAL_STATE: ReaderViewState = Object.freeze({
  fitMode: 'fitContain' as const,
  zoom: 1,
  rotation: 0 as Rotation
})

function clampZoom(value: number) {
  if (!Number.isFinite(value)) {
    return 1
  }
  return Math.min(READER_MAX_ZOOM, Math.max(READER_MIN_ZOOM, Number(value.toFixed(4))))
}

function normalizeRotation(value: number): Rotation {
  if (!Number.isFinite(value)) {
    return 0
  }
  const wrapped = ((value % 360) + 360) % 360
  const step = Math.round(wrapped / 90) % 4
  return ([0, 90, 180, 270] as const)[step] as Rotation
}

function reducer(state: ReaderViewState, action: ReaderViewAction): ReaderViewState {
  switch (action.type) {
    case 'set-fit-mode': {
      const nextFit = action.fitMode
      if (state.fitMode === nextFit) {
        return state
      }
      return {
        ...state,
        fitMode: nextFit,
        zoom: 1
      }
    }
    case 'set-zoom': {
      const nextZoom = clampZoom(action.zoom)
      if (Math.abs(nextZoom - state.zoom) < 0.0001) {
        return state
      }
      return {
        ...state,
        zoom: nextZoom
      }
    }
    case 'zoom-delta': {
      const nextZoom = clampZoom(state.zoom + action.delta)
      if (Math.abs(nextZoom - state.zoom) < 0.0001) {
        return state
      }
      return {
        ...state,
        zoom: nextZoom
      }
    }
    case 'set-rotation': {
      const nextRotation = normalizeRotation(action.rotation)
      if (nextRotation === state.rotation) {
        return state
      }
      return {
        ...state,
        rotation: nextRotation
      }
    }
    case 'rotate': {
      const delta = action.direction === 'cw' ? 90 : -90
      const nextRotation = normalizeRotation(state.rotation + delta)
      if (nextRotation === state.rotation) {
        return state
      }
      return {
        ...state,
        rotation: nextRotation
      }
    }
    case 'reset-view': {
      if (state.zoom === 1 && state.rotation === 0) {
        return state
      }
      return {
        ...state,
        zoom: 1,
        rotation: 0
      }
    }
    default:
      return state
  }
}

export interface ReaderViewModel {
  fitMode: FitMode
  zoom: number
  rotation: Rotation
  setFitMode: (mode: FitMode) => void
  setZoom: (value: number) => void
  zoomIn: () => void
  zoomOut: () => void
  setRotation: (rotation: Rotation) => void
  rotateClockwise: () => void
  rotateCounterClockwise: () => void
  resetView: () => void
  minZoom: number
  maxZoom: number
  zoomStep: number
}

export function useReaderViewModel(initial?: Partial<ReaderViewState>): ReaderViewModel {
  const [state, dispatch] = useReducer(reducer, {
    ...INITIAL_STATE,
    ...initial
  })

  const setFitMode = useCallback((mode: FitMode) => {
    dispatch({ type: 'set-fit-mode', fitMode: mode })
  }, [])

  const setZoom = useCallback((value: number) => {
    dispatch({ type: 'set-zoom', zoom: value })
  }, [])

  const zoomIn = useCallback(() => {
    dispatch({ type: 'zoom-delta', delta: READER_ZOOM_STEP })
  }, [])

  const zoomOut = useCallback(() => {
    dispatch({ type: 'zoom-delta', delta: -READER_ZOOM_STEP })
  }, [])

  const setRotation = useCallback((rotation: Rotation) => {
    dispatch({ type: 'set-rotation', rotation })
  }, [])

  const rotateClockwise = useCallback(() => {
    dispatch({ type: 'rotate', direction: 'cw' })
  }, [])

  const rotateCounterClockwise = useCallback(() => {
    dispatch({ type: 'rotate', direction: 'ccw' })
  }, [])

  const resetView = useCallback(() => {
    dispatch({ type: 'reset-view' })
  }, [])

  return useMemo(
    () => ({
      fitMode: state.fitMode,
      zoom: state.zoom,
      rotation: state.rotation,
      setFitMode,
      setZoom,
      zoomIn,
      zoomOut,
      setRotation,
      rotateClockwise,
      rotateCounterClockwise,
      resetView,
      minZoom: READER_MIN_ZOOM,
      maxZoom: READER_MAX_ZOOM,
      zoomStep: READER_ZOOM_STEP
    }),
    [rotateClockwise, rotateCounterClockwise, resetView, setFitMode, setRotation, setZoom, state.fitMode, state.rotation, state.zoom, zoomIn, zoomOut]
  )
}
