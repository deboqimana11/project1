import * as React from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

import type { PageMeta } from '@/ipc'
import { getThumbUrl } from '@/ipc'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

const DEFAULT_ITEM_HEIGHT = 128
const DEFAULT_LONGEST_EDGE = 320

export interface ThumbSidebarProps {
  pages: PageMeta[]
  activeIndex: number
  onSelect: (index: number) => void
  onContextMenuRequest?: (page: PageMeta, event: React.MouseEvent<HTMLButtonElement>) => void
  longestEdge?: number
  className?: string
}

export function ThumbSidebar({
  pages,
  activeIndex,
  onSelect,
  onContextMenuRequest,
  longestEdge = DEFAULT_LONGEST_EDGE,
  className
}: ThumbSidebarProps) {
  const [query, setQuery] = React.useState('')
  const listRef = React.useRef<HTMLDivElement | null>(null)

  const pageIndexMap = React.useMemo(() => {
    const map = new Map<string, number>()
    pages.forEach((page, index) => {
      map.set(makePageKey(page), index)
    })
    return map
  }, [pages])

  const filtered = React.useMemo(() => {
    if (!query.trim()) {
      return pages
    }
    const lower = query.trim().toLowerCase()
    return pages.filter((page) => page.relPath.toLowerCase().includes(lower))
  }, [pages, query])

  const activeFilteredIndex = React.useMemo(() => {
    if (activeIndex < 0 || activeIndex >= pages.length) {
      return -1
    }
    const activePage = pages[activeIndex]
    const activeKey = makePageKey(activePage)
    return filtered.findIndex((item) => makePageKey(item) === activeKey)
  }, [activeIndex, filtered, pages])

  const virtualizer = useVirtualizer({
    count: filtered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => DEFAULT_ITEM_HEIGHT,
    overscan: 6,
    measureElement: (element) => element.getBoundingClientRect().height
  })

  React.useEffect(() => {
    if (filtered.length > 0 && activeFilteredIndex >= 0) {
      virtualizer.scrollToIndex(activeFilteredIndex, { align: 'center' })
    }
  }, [activeFilteredIndex, filtered.length, virtualizer])

  return (
    <aside
      className={cn(
        'hidden w-[280px] flex-shrink-0 border-r border-border bg-surface/95 backdrop-blur-md md:flex',
        className
      )}
    >
      <div className="flex h-full w-full flex-col">
        <div className="border-b border-border/70 p-3">
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter pages"
            className="h-9 bg-surface"
          />
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto" data-testid="thumb-scroll">
          {filtered.length === 0 ? (
            <EmptyState query={query} />
          ) : (
            <div style={{ height: `${virtualizer.getTotalSize()}px` }} className="relative">
              {virtualizer.getVirtualItems().map((virtualItem) => {
                const page = filtered[virtualItem.index]
                const originalIndex = pageIndexMap.get(makePageKey(page)) ?? virtualItem.index
                const isActive = originalIndex === activeIndex

                return (
                  <ThumbItem
                    key={virtualItem.key}
                    page={page}
                    index={originalIndex}
                    isActive={isActive}
                    longestEdge={longestEdge}
                    onSelect={onSelect}
                    onContextMenuRequest={onContextMenuRequest}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`
                    }}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

interface ThumbItemProps {
  page: PageMeta
  index: number
  isActive: boolean
  longestEdge: number
  onSelect: (index: number) => void
  onContextMenuRequest?: (page: PageMeta, event: React.MouseEvent<HTMLButtonElement>) => void
  style: React.CSSProperties
}

function ThumbItem({
  page,
  index,
  isActive,
  longestEdge,
  onSelect,
  onContextMenuRequest,
  style
}: ThumbItemProps) {
  const [thumbUrl, setThumbUrl] = React.useState<string | null>(null)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const url = await getThumbUrl(page.id, longestEdge)
        if (!cancelled) {
          setThumbUrl(url)
          setFailed(false)
        }
      } catch (error) {
        console.error('Failed to load thumbnail', error)
        if (!cancelled) {
          setThumbUrl(null)
          setFailed(true)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [page.id, longestEdge])

  const handleClick = React.useCallback(() => {
    onSelect(index)
  }, [index, onSelect])

  const handleContextMenu = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (onContextMenuRequest) {
        event.preventDefault()
        onContextMenuRequest(page, event)
      }
    },
    [onContextMenuRequest, page]
  )

  return (
    <button
      type="button"
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      style={style}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group flex w-full items-center gap-3 px-3 py-2 text-left transition-all duration-fast ease-elegant',
        isActive ? 'bg-surface-2/70' : 'hover:bg-surface-2/50'
      )}
    >
      <div
        className={cn(
          'relative h-[108px] w-[84px] overflow-hidden rounded-lg border border-border/60 bg-surface shadow-soft transition-all duration-fast ease-elegant',
          isActive ? 'ring-2 ring-accent' : 'group-hover:border-accent/40'
        )}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt={`Page ${page.id.index + 1}`}
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-surface-2 text-xs text-muted">
            {failed ? 'No preview' : 'Loading…'}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted">
        <span className="text-sm font-medium text-text">Page {page.id.index + 1}</span>
        <span className="truncate">{page.relPath}</span>
        <span className="tabular-nums text-[0.7rem]">{page.width} × {page.height}</span>
      </div>
    </button>
  )
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted">
      <span className="font-medium text-text">No pages found</span>
      {query ? <span>No results match “{query}”.</span> : <span>Load a bundle to see thumbnails.</span>}
    </div>
  )
}

function makePageKey(page: PageMeta) {
  return `${page.id.sourceId}-${page.id.index}`
}
