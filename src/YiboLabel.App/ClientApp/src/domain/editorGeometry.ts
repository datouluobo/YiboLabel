import type { LabelDocument, LabelElement } from '../types'
import { clamp, roundTo, reindexElements, sortElements } from './labelDocument'

export const snapDistanceMm = 0.8

export type Point = {
  x: number
  y: number
}

export type Bounds = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  centerX: number
  centerY: number
}

export type RulerTick = {
  value: number
  major: boolean
}

export type SnapLine = {
  orientation: 'vertical' | 'horizontal'
  value: number
}

export function getElementBounds(element: LabelElement): Bounds {
  const left = element.x
  const top = element.y
  const right = element.x + element.width
  const bottom = element.y + element.height
  return {
    left,
    top,
    right,
    bottom,
    width: element.width,
    height: element.height,
    centerX: left + element.width / 2,
    centerY: top + element.height / 2,
  }
}

export function getSelectionBounds(elements: LabelElement[]): Bounds | null {
  if (elements.length === 0) {
    return null
  }

  const left = Math.min(...elements.map((element) => element.x))
  const top = Math.min(...elements.map((element) => element.y))
  const right = Math.max(...elements.map((element) => element.x + element.width))
  const bottom = Math.max(...elements.map((element) => element.y + element.height))
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

export function boundsIntersect(left: Bounds, right: Bounds) {
  return left.left <= right.right && left.right >= right.left && left.top <= right.bottom && left.bottom >= right.top
}

export function pointFromPointer(bounds: DOMRect, event: { clientX: number; clientY: number }, scale: number): Point {
  return {
    x: clamp((event.clientX - bounds.left) / scale, 0, bounds.width / scale),
    y: clamp((event.clientY - bounds.top) / scale, 0, bounds.height / scale),
  }
}

export function getMarqueeBounds(start: Point, current: Point): Bounds {
  const left = Math.min(start.x, current.x)
  const top = Math.min(start.y, current.y)
  const right = Math.max(start.x, current.x)
  const bottom = Math.max(start.y, current.y)
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  }
}

export function createRulerTicks(lengthMm: number): RulerTick[] {
  const ticks: RulerTick[] = []
  for (let value = 0; value <= lengthMm + 0.01; value += 5) {
    const rounded = roundTo(value, 0.1)
    ticks.push({ value: rounded, major: Math.round(rounded) % 10 === 0 })
  }
  return ticks
}

export function getElementsAtPoint(document: LabelDocument, point: Point) {
  return sortElements(document.elements)
    .filter((element) => !element.hidden)
    .filter((element) => {
      const bounds = getElementBounds(element)
      return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom
    })
}

export function getSnapTargets(document: LabelDocument, excludedIds: string[]) {
  const excluded = new Set(excludedIds)
  const vertical = [0, document.widthMm / 2, document.widthMm]
  const horizontal = [0, document.heightMm / 2, document.heightMm]

  for (const element of document.elements) {
    if (excluded.has(element.id) || element.hidden) {
      continue
    }

    const bounds = getElementBounds(element)
    vertical.push(bounds.left, bounds.centerX, bounds.right)
    horizontal.push(bounds.top, bounds.centerY, bounds.bottom)
  }

  return { vertical, horizontal }
}

export function findBestSnap(value: number, targets: number[]) {
  let bestDelta = 0
  let bestDistance = snapDistanceMm + 1
  let bestTarget: number | null = null

  for (const target of targets) {
    const delta = target - value
    const distance = Math.abs(delta)
    if (distance <= snapDistanceMm && distance < bestDistance) {
      bestDistance = distance
      bestDelta = delta
      bestTarget = target
    }
  }

  return { delta: bestDelta, target: bestTarget }
}

export function snapMoveBounds(bounds: Bounds, document: LabelDocument, selectedIds: string[]) {
  const targets = getSnapTargets(document, selectedIds)
  const xCandidates = [bounds.left, bounds.centerX, bounds.right]
  const yCandidates = [bounds.top, bounds.centerY, bounds.bottom]

  let deltaX = 0
  let deltaY = 0
  let verticalLine: number | null = null
  let horizontalLine: number | null = null

  for (const candidate of xCandidates) {
    const snap = findBestSnap(candidate + deltaX, targets.vertical)
    if (snap.target !== null && (verticalLine === null || Math.abs(snap.delta) < Math.abs(deltaX))) {
      deltaX = snap.delta
      verticalLine = snap.target
    }
  }

  for (const candidate of yCandidates) {
    const snap = findBestSnap(candidate + deltaY, targets.horizontal)
    if (snap.target !== null && (horizontalLine === null || Math.abs(snap.delta) < Math.abs(deltaY))) {
      deltaY = snap.delta
      horizontalLine = snap.target
    }
  }

  return {
    deltaX,
    deltaY,
    lines: [
      ...(verticalLine === null ? [] : [{ orientation: 'vertical' as const, value: verticalLine }]),
      ...(horizontalLine === null ? [] : [{ orientation: 'horizontal' as const, value: horizontalLine }]),
    ],
  }
}

export function reorderElements(
  elements: LabelElement[],
  selectedIds: string[],
  action: 'front' | 'back' | 'forward' | 'backward',
) {
  const selected = new Set(selectedIds)
  const ordered = sortElements(elements)
  const selectedItems = ordered.filter((element) => selected.has(element.id))
  const unselectedItems = ordered.filter((element) => !selected.has(element.id))

  if (action === 'front') {
    return reindexElements([...unselectedItems, ...selectedItems])
  }

  if (action === 'back') {
    return reindexElements([...selectedItems, ...unselectedItems])
  }

  const result = [...ordered]
  if (action === 'forward') {
    for (let index = result.length - 2; index >= 0; index -= 1) {
      if (selected.has(result[index].id) && !selected.has(result[index + 1].id)) {
        ;[result[index], result[index + 1]] = [result[index + 1], result[index]]
      }
    }
    return reindexElements(result)
  }

  for (let index = 1; index < result.length; index += 1) {
    if (selected.has(result[index].id) && !selected.has(result[index - 1].id)) {
      ;[result[index], result[index - 1]] = [result[index - 1], result[index]]
    }
  }

  return reindexElements(result)
}
