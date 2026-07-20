import type { BarcodeElement, LabelDocument, LabelElement, QrCodeElement, TextElement } from '../types'
import { assignLayerOrder, clamp, pointsToMm, roundTo, sortElements } from './labelDocument'
import { getBarcodeLayout, getQrCodeLayout } from './codeElementLayout'

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
    return assignLayerOrder([...unselectedItems, ...selectedItems])
  }

  if (action === 'back') {
    return assignLayerOrder([...selectedItems, ...unselectedItems])
  }

  const result = [...ordered]
  if (action === 'forward') {
    for (let index = result.length - 2; index >= 0; index -= 1) {
      if (selected.has(result[index].id) && !selected.has(result[index + 1].id)) {
        ;[result[index], result[index + 1]] = [result[index + 1], result[index]]
      }
    }
    return assignLayerOrder(result)
  }

  for (let index = 1; index < result.length; index += 1) {
    if (selected.has(result[index].id) && !selected.has(result[index - 1].id)) {
      ;[result[index], result[index - 1]] = [result[index - 1], result[index]]
    }
  }

  return assignLayerOrder(result)
}

export function getElementPrintBounds(element: LabelElement): Bounds {
  if (element.type === 'text') {
    return createTextPrintBounds(element)
  }

  if (element.type === 'barcode') {
    return createCodePrintBounds(element, getBarcodeLayout(element, element.width, element.height, 1))
  }

  if (element.type === 'qrcode') {
    return createCodePrintBounds(element, getQrCodeLayout(element, element.width, element.height, 1))
  }

  return getElementBounds(element)
}

export function getElementOverlapRegion(left: LabelElement, right: LabelElement): Bounds | null {
  const leftBounds = getElementPrintBounds(left)
  const rightBounds = getElementPrintBounds(right)
  const overlap = intersectBounds(leftBounds, rightBounds)
  if (!overlap) {
    return null
  }

  if (!isMeaningfulOverlap(left, right, overlap, leftBounds, rightBounds)) {
    return null
  }

  return overlap
}

export type ElementOverlapSummary = {
  overlapCount: number
  barcodeOrQrOverlapCount: number
}

export function getVisibleElementOverlapSummary(elements: LabelElement[]): ElementOverlapSummary {
  let overlapCount = 0
  let barcodeOrQrOverlapCount = 0

  for (let leftIndex = 0; leftIndex < elements.length - 1; leftIndex += 1) {
    const left = elements[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < elements.length; rightIndex += 1) {
      const right = elements[rightIndex]
      if (!getElementOverlapRegion(left, right)) {
        continue
      }

      overlapCount += 1
      if (left.type === 'barcode' || left.type === 'qrcode' || right.type === 'barcode' || right.type === 'qrcode') {
        barcodeOrQrOverlapCount += 1
      }
    }
  }

  return { overlapCount, barcodeOrQrOverlapCount }
}

function createTextPrintBounds(element: TextElement): Bounds {
  const contentHeight = clamp(roundTo(pointsToMm(element.fontSize) * 1.18, 0.1), minVisualPrintSizeMm, element.height)
  return createBounds(element.x, element.y, element.width, contentHeight)
}

function createCodePrintBounds(
  element: BarcodeElement | QrCodeElement,
  layout: {
    code: { x: number; y: number; width: number; height: number }
    text: { x: number; y: number; width: number; height: number } | null
  },
): Bounds {
  const parts = [layout.code, ...(layout.text ? [layout.text] : [])]
  const left = Math.min(...parts.map((part) => part.x))
  const top = Math.min(...parts.map((part) => part.y))
  const right = Math.max(...parts.map((part) => part.x + part.width))
  const bottom = Math.max(...parts.map((part) => part.y + part.height))
  return createBounds(element.x + left, element.y + top, right - left, bottom - top)
}

function createBounds(left: number, top: number, width: number, height: number): Bounds {
  const safeWidth = Math.max(0, width)
  const safeHeight = Math.max(0, height)
  return {
    left,
    top,
    right: left + safeWidth,
    bottom: top + safeHeight,
    width: safeWidth,
    height: safeHeight,
    centerX: left + safeWidth / 2,
    centerY: top + safeHeight / 2,
  }
}

function intersectBounds(left: Bounds, right: Bounds): Bounds | null {
  const overlapLeft = Math.max(left.left, right.left)
  const overlapTop = Math.max(left.top, right.top)
  const overlapRight = Math.min(left.right, right.right)
  const overlapBottom = Math.min(left.bottom, right.bottom)
  if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
    return null
  }

  return createBounds(overlapLeft, overlapTop, overlapRight - overlapLeft, overlapBottom - overlapTop)
}

function isMeaningfulOverlap(
  leftElement: LabelElement,
  rightElement: LabelElement,
  overlap: Bounds,
  leftBounds: Bounds,
  rightBounds: Bounds,
) {
  const includesCode =
    leftElement.type === 'barcode'
    || leftElement.type === 'qrcode'
    || rightElement.type === 'barcode'
    || rightElement.type === 'qrcode'
  if (includesCode) {
    return true
  }

  const linePair = leftElement.type === 'line' || rightElement.type === 'line'
  if (!linePair) {
    return true
  }

  const overlapArea = overlap.width * overlap.height
  const smallerArea = Math.max(
    minVisualPrintSizeMm * minVisualPrintSizeMm,
    Math.min(leftBounds.width * leftBounds.height, rightBounds.width * rightBounds.height),
  )
  const overlapDepth = Math.min(overlap.width, overlap.height)
  return overlapArea / smallerArea >= 0.2 || overlapDepth >= 0.9
}

const minVisualPrintSizeMm = 0.4
