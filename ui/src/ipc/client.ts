import { invoke, convertFileSrc } from '@tauri-apps/api/core'

import { createBrowserBridge } from './mock'
import type {
  PageId,
  PageMeta,
  PerfStats,
  PrefetchPolicy,
  RenderParams,
  RequestToken,
  SourceId
} from './types'

interface IpcBridge {
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

const tauriBridge: IpcBridge = createTauriBridge()
const browserBridge: IpcBridge = createBrowserBridge()

let usingMockFallback = false

function shouldFallbackToMock(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  const message = error.message ?? ''
  return (
    error instanceof ReferenceError && /__TAURI__/i.test(message)
  )
}

async function callBridge<T>(resolver: (bridge: IpcBridge) => Promise<T>): Promise<T> {
  if (!usingMockFallback) {
    try {
      return await resolver(tauriBridge)
    } catch (error) {
      if (shouldFallbackToMock(error)) {
        console.warn('[ipc] Tauri bridge unavailable, falling back to browser mock', error)
        usingMockFallback = true
      } else {
        throw error
      }
    }
  }
  return resolver(browserBridge)
}

export async function openPath(path: string): Promise<SourceId> {
  return callBridge((activeBridge) => activeBridge.openPath(path))
}

export async function listPages(sourceId: SourceId): Promise<PageMeta[]> {
  return callBridge((activeBridge) => activeBridge.listPages(sourceId))
}

export async function getPageUrl(page: PageId, params: RenderParams): Promise<string> {
  return callBridge((activeBridge) => activeBridge.getPageUrl(page, params))
}

export async function getThumbUrl(page: PageId, longest: number): Promise<string> {
  return callBridge((activeBridge) => activeBridge.getThumbUrl(page, longest))
}

export async function prefetch(center: PageId, policy: PrefetchPolicy): Promise<RequestToken> {
  return callBridge((activeBridge) => activeBridge.prefetch(center, policy))
}

export async function cancel(token: RequestToken): Promise<void> {
  return callBridge((activeBridge) => activeBridge.cancel(token))
}

export async function saveProgress(sourceId: SourceId, page: number): Promise<void> {
  return callBridge((activeBridge) => activeBridge.saveProgress(sourceId, page))
}

export async function queryProgress(sourceId: SourceId): Promise<number> {
  return callBridge((activeBridge) => activeBridge.queryProgress(sourceId))
}

export async function fetchStats(): Promise<PerfStats> {
  return callBridge((activeBridge) => activeBridge.fetchStats())
}

export function buildPrefetchToken(page: PageId): RequestToken {
  return `prefetch-${page.sourceId}-${page.index}`
}

export function buildRenderParams(partial?: Partial<RenderParams>): RenderParams {
  return {
    fit: 'fitContain',
    viewportW: 1280,
    viewportH: 720,
    scale: 1,
    rotation: 0,
    dpi: 96,
    ...partial
  }
}

function createTauriBridge(): IpcBridge {
  return {
    async openPath(path) {
      return invoke<SourceId>('open_path', { path })
    },
    async listPages(sourceId) {
      return invoke<PageMeta[]>('list_pages', { source_id: sourceId, sourceId })
    },
    async getPageUrl(page, params) {
      const path = await invoke<string>('get_page_url', { page, params })
      return convertFileSrc(path)
    },
    async getThumbUrl(page, longest) {
      const path = await invoke<string>('get_thumb_url', { page, longest })
      return convertFileSrc(path)
    },
    async prefetch(center, policy) {
      await invoke<void>('prefetch', { center, policy })
      return buildPrefetchToken(center)
    },
    async cancel(token) {
      await invoke<void>('cancel', { token })
    },
   async saveProgress(sourceId, page) {
      await invoke<void>('save_progress', { source_id: sourceId, sourceId, page })
    },
    async queryProgress(sourceId) {
      return invoke<number>('query_progress', { source_id: sourceId, sourceId })
    },
    async fetchStats() {
      return invoke<PerfStats>('stats')
    }
  }
}
