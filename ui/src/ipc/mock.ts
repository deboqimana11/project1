import type {
  PageId,
  PageMeta,
  PerfStats,
  PrefetchPolicy,
  RenderParams,
  RequestToken,
  SourceId
} from './types'

interface BrowserBridgeState {
  nextSourceId: number
  sourcesByPath: Map<string, SourceState>
  sourcesById: Map<SourceId, SourceState>
  pendingTokens: Set<string>
  progressBySource: Map<SourceId, number>
}

interface SourceState {
  id: SourceId
  path: string
  pages: PageMeta[]
}

interface BrowserBridge {
  openPath(path: string): Promise<SourceId>
  listPages(sourceId: SourceId): Promise<PageMeta[]>
  getPageUrl(page: PageId, params: RenderParams): Promise<string>
  getThumbUrl(page: PageId, longest: number): Promise<string>
  prefetch(center: PageId, policy: PrefetchPolicy): Promise<RequestToken>
  cancel(token: RequestToken): Promise<void>
  saveProgress(sourceId: SourceId, page: number): Promise<void>
  queryProgress(sourceId: SourceId): Promise<number>
  fetchStats(): Promise<PerfStats>
}

const PLACEHOLDER_PAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAWgAAAJYCAYAAAC5pTKtAAAESElEQVR4nO3VsQ3CMBQEwYxho68x9ESnSzzgLU4FXmwdNo0/gPuD1Kfz0C37hAAAAAAAoM2ufj+6Xlzc+rLFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhb2RXsDr5GJwAAAP//AwCA3VXWpY1pfgAAAABJRU5ErkJggg=='

const PLACEHOLDER_THUMB_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAADwAAAA8CAYAAAA6/NlyAAABN0lEQVR4nO3WPQrCQBiG4V+KElEQtNOQJrQIj8AHd3cmWo6hLQfQIXQ1KaeeEWH14K5M7jwGkh06ZMmTJlypQpU6ZMmTIl+zsy2pu2kjKOohyPcRKHQ8YwhzPWRpCXPGAItLZhBviK7GmEHeIrsbIQd4quxpBDPiK7WkEO+IrsaQQ74iuxtBDPiK7GkEO+IrsaQQz4iu1pBDviK7GkEM+IrtaQQ74iuxpBDPiK7WkEO+IrsaQQ74iuxtBDPiK7GkEO+IrsaQQ74iuxtBDPiK7WkEO+IrsaQQ74iu1pBDPiK7GkEO+IrtaQQ74iuxtBDPiK7GkEO+IrsaQQ74iuxtBDPiK7WkEO+IrsaQQ74iuxtBDPiK7GkEO+IrsaQQ74iuxtBDPiK7WkEO+IrsaQQ74iuxtBDPiK7WkEO+IrsaQQ74iuxtBPti9LwddL9uJAAAAAElFTkSuQmCC'

function generatePages(sourceId: SourceId, count = 1200): PageMeta[] {
  return Array.from({ length: count }, (_, index) => {
    const spreadStride = 3
    const isDoubleSpread = index % spreadStride === spreadStride - 1
    const baseWidth = isDoubleSpread ? 3200 : 1600
    const baseHeight = 2400
    return {
      id: { sourceId, index },
      relPath: `demo-bundle/page_${String(index + 1).padStart(4, '0')}.png`,
      width: baseWidth,
      height: baseHeight,
      isDoubleSpread
    }
  })
}

function ensureSource(state: BrowserBridgeState, path: string): SourceState {
  const key = path || 'demo-bundle'
  let source = state.sourcesByPath.get(key)
  if (source) {
    return source
  }

  state.nextSourceId += 1
  const id: SourceId = `mock-${state.nextSourceId}`
  source = {
    id,
    path: key,
    pages: generatePages(id)
  }
  state.sourcesByPath.set(key, source)
  state.sourcesById.set(id, source)
  return source
}

function encodeDataUrl(base64: string, suffix: string): string {
  return `data:image/png;base64,${base64}#${suffix}`
}

export function createBrowserBridge(): BrowserBridge {
  const state: BrowserBridgeState = {
    nextSourceId: 0,
    sourcesByPath: new Map(),
    sourcesById: new Map(),
    pendingTokens: new Set(),
    progressBySource: new Map()
  }

  const bridge: BrowserBridge = {
    openPath(path) {
      const source = ensureSource(state, path)
      return Promise.resolve(source.id)
    },
    listPages(sourceId) {
      const source = state.sourcesById.get(sourceId)
      if (!source) {
        return Promise.reject(new Error('unknown source'))
      }
      const pages = source.pages.map((page) => ({ ...page, id: { ...page.id } }))
      return Promise.resolve(pages)
    },
    getPageUrl(page, _params) {
      void _params
      return Promise.resolve(encodeDataUrl(PLACEHOLDER_PAGE_BASE64, `page-${page.sourceId}-${page.index}`))
    },
    getThumbUrl(page, longest) {
      return Promise.resolve(
        encodeDataUrl(PLACEHOLDER_THUMB_BASE64, `thumb-${page.sourceId}-${page.index}-${longest}`)
      )
    },
    prefetch(center, _policy) {
      void _policy
      const token: RequestToken = `prefetch-${center.sourceId}-${center.index}`
      state.pendingTokens.add(token)
      return Promise.resolve(token)
    },
    cancel(token) {
      state.pendingTokens.delete(token)
      return Promise.resolve()
    },
    saveProgress(sourceId, page) {
      state.progressBySource.set(sourceId, page)
      return Promise.resolve()
    },
    queryProgress(sourceId) {
      return Promise.resolve(state.progressBySource.get(sourceId) ?? 0)
    },
    fetchStats() {
      const cachedPages = Array.from(state.sourcesById.values()).reduce(
        (sum, source) => sum + source.pages.length,
        0
      )
      const payload: PerfStats = {
        timestampMs: Date.now(),
        activeSources: state.sourcesById.size,
        cachedPages,
        pendingPrefetch: state.pendingTokens.size
      }
      return Promise.resolve(payload)
    }
  }

  return bridge
}
