import * as React from 'react'

import type { FitMode } from '@/ipc'
import { cn } from '@/lib/utils'

import { ReaderCanvas } from './reader-canvas'
import type { PageGroup } from './page-groups'
import { clampGroupIndex } from './page-groups'
import type { ReadingDirection, ReadingLayout } from './toolbar'
import type { Rotation } from './view-model'

interface ReaderViewportProps {
  groups: PageGroup[]
  activeGroupIndex: number
  readingLayout: ReadingLayout
  readingDirection: ReadingDirection
  fitMode: FitMode
  zoom: number
  rotation: Rotation
  minZoom: number
  maxZoom: number
  zoomStep: number
  onZoomChange?: (value: number) => void
}

export function ReaderViewport({
  groups,
  activeGroupIndex,
  readingLayout,
  readingDirection,
  fitMode,
  zoom,
  rotation,
  minZoom,
  maxZoom,
  zoomStep,
  onZoomChange
}: ReaderViewportProps) {
  const hasGroups = groups.length > 0

  const normalizedIndex = React.useMemo(() => {
    if (!hasGroups) {
      return -1
    }
    return clampGroupIndex(groups, activeGroupIndex)
  }, [activeGroupIndex, groups, hasGroups])

  const activeGroup = React.useMemo(() => {
    if (!hasGroups || normalizedIndex === -1) {
      return null
    }
    return groups[normalizedIndex] ?? null
  }, [groups, hasGroups, normalizedIndex])

  const displayPages = React.useMemo(() => {
    if (!activeGroup) {
      return []
    }
    if (readingLayout === 'vertical') {
      return activeGroup.pages
    }
    return readingDirection === 'rtl' ? [...activeGroup.pages].reverse() : activeGroup.pages
  }, [activeGroup, readingDirection, readingLayout])

  const groupRefs = React.useRef(new Map<string, HTMLDivElement>())

  const attachGroupRef = React.useCallback((groupId: string, node: HTMLDivElement | null) => {
    if (node) {
      groupRefs.current.set(groupId, node)
    } else {
      groupRefs.current.delete(groupId)
    }
  }, [])

  React.useEffect(() => {
    if (!hasGroups || readingLayout !== 'vertical') {
      return
    }
    if (!activeGroup) {
      return
    }
    const node = groupRefs.current.get(activeGroup.id)
    if (!node) {
      return
    }
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeGroup, hasGroups, readingLayout])

  if (!hasGroups) {
    return <div className="h-full w-full" />
  }

  if (readingLayout === 'vertical') {
    return (
      <div className="flex h-full w-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-6">
          {groups.map((group) => {
            const pagesForDisplay = readingDirection === 'rtl' ? [...group.pages].reverse() : group.pages
            const isActive = activeGroup?.id === group.id
            return (
              <div
                key={group.id}
                ref={(node) => attachGroupRef(group.id, node)}
                className={cn(
                  'flex flex-col items-center gap-4 rounded-xl border border-transparent bg-surface/60 px-4 py-6 transition-colors duration-fast ease-elegant shadow-soft',
                  isActive ? 'border-accent/60 bg-surface-2/80' : 'border-border/40'
                )}
              >
                {pagesForDisplay.map((page) => (
                  <div key={`${group.id}-${page.id.index}`} className="w-full">
                    <ReaderCanvas
                      page={page}
                      className="h-auto w-full"
                      fitMode={fitMode}
                      zoom={zoom}
                      rotation={rotation}
                      minZoom={minZoom}
                      maxZoom={maxZoom}
                      zoomStep={zoomStep}
                      onZoomChange={onZoomChange}
                    />
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  if (readingLayout === 'double') {
    return (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center gap-6 px-4',
          readingDirection === 'rtl' ? 'flex-row-reverse' : 'flex-row'
        )}
      >
        {displayPages.length === 0 ? (
          <div className="h-full w-full" />
        ) : (
          displayPages.map((page) => (
            <div
              key={`spread-${page.id.index}`}
              className="relative flex h-full max-w-[50%] flex-1 items-center justify-center"
            >
              <ReaderCanvas
                page={page}
                className="h-full w-full"
                fitMode={fitMode}
                zoom={zoom}
                rotation={rotation}
                minZoom={minZoom}
                maxZoom={maxZoom}
                zoomStep={zoomStep}
                onZoomChange={onZoomChange}
              />
            </div>
          ))
        )}
      </div>
    )
  }

  const page = displayPages[0] ?? activeGroup?.pages[0] ?? null

  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="relative h-full w-full">
        <ReaderCanvas
          page={page}
          className="h-full w-full"
          fitMode={fitMode}
          zoom={zoom}
          rotation={rotation}
          minZoom={minZoom}
          maxZoom={maxZoom}
          zoomStep={zoomStep}
          onZoomChange={onZoomChange}
        />
      </div>
    </div>
  )
}
