import type { PageMeta } from '@/ipc'

import type { ReadingLayout } from './toolbar'

export interface PageGroup {
  id: string
  pages: PageMeta[]
  startIndex: number
  endIndex: number
}

export function createPageGroups(pages: PageMeta[], layout: ReadingLayout): PageGroup[] {
  switch (layout) {
    case 'double':
      return createDoubleGroups(pages)
    case 'vertical':
      return createSingleGroups(pages)
    case 'single':
    default:
      return createSingleGroups(pages)
  }
}

export function findGroupIndexByPage(groups: PageGroup[], pageIndex: number): number {
  if (groups.length === 0) {
    return -1
  }
  return groups.findIndex((group) => pageIndex >= group.startIndex && pageIndex <= group.endIndex)
}

export function getGroupStartIndex(groups: PageGroup[], groupIndex: number): number {
  const clamped = clampGroupIndex(groups, groupIndex)
  if (clamped === -1) {
    return -1
  }
  return groups[clamped]?.startIndex ?? -1
}

export function clampGroupIndex(groups: PageGroup[], index: number): number {
  if (groups.length === 0) {
    return -1
  }
  if (index < 0) {
    return 0
  }
  if (index > groups.length - 1) {
    return groups.length - 1
  }
  return index
}

export function getGroupPageNumbers(group: PageGroup | null | undefined): number[] {
  if (!group) {
    return []
  }
  return group.pages.map((page) => page.id.index + 1)
}

function createSingleGroups(pages: PageMeta[]): PageGroup[] {
  return pages.map((page) => ({
    id: `page-${page.id.index}`,
    pages: [page],
    startIndex: page.id.index,
    endIndex: page.id.index
  }))
}

function createDoubleGroups(pages: PageMeta[]): PageGroup[] {
  const groups: PageGroup[] = []
  let index = 0

  while (index < pages.length) {
    const current = pages[index]
    if (!current) {
      break
    }

    if (current.isDoubleSpread) {
      groups.push({
        id: `spread-${current.id.index}`,
        pages: [current],
        startIndex: current.id.index,
        endIndex: current.id.index
      })
      index += 1
      continue
    }

    if (index === 0) {
      groups.push({
        id: `spread-${current.id.index}`,
        pages: [current],
        startIndex: current.id.index,
        endIndex: current.id.index
      })
      index += 1
      continue
    }

    const next = pages[index + 1]
    if (next && !next.isDoubleSpread) {
      groups.push({
        id: `spread-${current.id.index}-${next.id.index}`,
        pages: [current, next],
        startIndex: current.id.index,
        endIndex: next.id.index
      })
      index += 2
      continue
    }

    groups.push({
      id: `spread-${current.id.index}`,
      pages: [current],
      startIndex: current.id.index,
      endIndex: current.id.index
    })
    index += 1
  }

  return groups
}
