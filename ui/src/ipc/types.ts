export type SourceId = string
export type RequestToken = string

export type FitMode = 'fitWidth' | 'fitHeight' | 'fitContain' | 'original' | 'fill'

export interface PageId {
  sourceId: SourceId
  index: number
}

export interface PageMeta {
  id: PageId
  relPath: string
  width: number
  height: number
  isDoubleSpread: boolean
}

export interface RenderParams {
  fit: FitMode
  viewportW: number
  viewportH: number
  scale: number
  rotation: number
  dpi: number
}

export interface PrefetchPolicy {
  ahead: number
  behind: number
}

export interface PerfStats {
  timestampMs: number
  activeSources: number
  cachedPages: number
  pendingPrefetch: number
}
