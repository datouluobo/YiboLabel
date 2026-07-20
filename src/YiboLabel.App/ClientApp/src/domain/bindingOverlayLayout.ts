import type { LabelElement } from '../types'

export type BindingOverlayPlacement = 'top' | 'right' | 'bottom' | 'left'

export type BindingOverlayLayout = {
  elementId: string
  names: string[]
  placement: BindingOverlayPlacement
  left: number
  top: number
  width: number
  height: number
  anchorOffset: number
}

type Rect = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

type LayoutCandidate = BindingOverlayLayout & {
  rect: Rect
  alignmentShift: number
}

const canvasInset = 4
const elementGap = 5
const badgeGap = 4
const badgeHeight = 22
const maximumBadgeWidth = 160

export function createBindingOverlayLayouts({
  items,
  elements,
  canvasWidth,
  canvasHeight,
  scale,
}: {
  items: { elementId: string; names: string[] }[]
  elements: LabelElement[]
  canvasWidth: number
  canvasHeight: number
  scale: number
}): BindingOverlayLayout[] {
  const visibleElements = elements.filter((element) => !element.hidden)
  const elementRects = visibleElements.map((element) => ({
    elementId: element.id,
    rect: getRotatedElementRect(element, scale),
  }))
  const occupiedBadgeRects: Rect[] = []
  const layouts: BindingOverlayLayout[] = []

  for (const item of items) {
    const ownerRect = elementRects.find(({ elementId }) => elementId === item.elementId)?.rect
    const names = item.names
    if (!ownerRect || names.length === 0) {
      continue
    }

    const candidates = createCandidates(item.elementId, names, ownerRect, canvasWidth, canvasHeight)
    const best = candidates
      .map((candidate) => ({
        candidate,
        score: scoreCandidate(candidate, elementRects, occupiedBadgeRects, canvasWidth, canvasHeight),
      }))
      .sort((left, right) => left.score - right.score)[0]?.candidate

    if (!best) {
      continue
    }

    const { rect, alignmentShift: _alignmentShift, ...layout } = best
    occupiedBadgeRects.push(rect)
    layouts.push(layout)
  }

  return layouts
}

function createCandidates(
  elementId: string,
  names: string[],
  owner: Rect,
  canvasWidth: number,
  canvasHeight: number,
): LayoutCandidate[] {
  const badgeWidths = names.map(estimateBadgeWidth)
  const horizontalWidth = badgeWidths.reduce((total, width) => total + width, 0) + Math.max(0, names.length - 1) * badgeGap
  const horizontalHeight = badgeHeight
  const verticalWidth = Math.max(...badgeWidths)
  const verticalHeight = names.length * badgeHeight + Math.max(0, names.length - 1) * badgeGap
  const horizontalPositions = uniqueNumbers([
    owner.left,
    owner.left + (owner.width - horizontalWidth) / 2,
    owner.right - horizontalWidth,
  ]).map((left) => clamp(left, canvasInset, Math.max(canvasInset, canvasWidth - horizontalWidth - canvasInset)))
  const verticalPositions = uniqueNumbers([
    owner.top,
    owner.top + (owner.height - verticalHeight) / 2,
    owner.bottom - verticalHeight,
  ]).map((top) => clamp(top, canvasInset, Math.max(canvasInset, canvasHeight - verticalHeight - canvasInset)))
  const candidates: LayoutCandidate[] = []

  for (const left of horizontalPositions) {
    candidates.push(createCandidate(elementId, names, 'top', left, owner.top - horizontalHeight - elementGap, horizontalWidth, horizontalHeight, owner))
    candidates.push(createCandidate(elementId, names, 'bottom', left, owner.bottom + elementGap, horizontalWidth, horizontalHeight, owner))
  }

  for (const top of verticalPositions) {
    candidates.push(createCandidate(elementId, names, 'right', owner.right + elementGap, top, verticalWidth, verticalHeight, owner))
    candidates.push(createCandidate(elementId, names, 'left', owner.left - verticalWidth - elementGap, top, verticalWidth, verticalHeight, owner))
  }

  return candidates
}

function createCandidate(
  elementId: string,
  names: string[],
  placement: BindingOverlayPlacement,
  left: number,
  top: number,
  width: number,
  height: number,
  owner: Rect,
): LayoutCandidate {
  const horizontal = placement === 'top' || placement === 'bottom'
  const ownerAnchor = horizontal ? owner.left + owner.width / 2 : owner.top + owner.height / 2
  const candidateStart = horizontal ? left : top
  const candidateLength = horizontal ? width : height
  const anchorOffset = clamp(ownerAnchor - candidateStart, 8, Math.max(8, candidateLength - 8))
  const alignmentShift = Math.abs(ownerAnchor - (candidateStart + candidateLength / 2))
  const rect = { left, top, right: left + width, bottom: top + height, width, height }

  return { elementId, names, placement, left, top, width, height, anchorOffset, alignmentShift, rect }
}

function scoreCandidate(
  candidate: LayoutCandidate,
  elementRects: { elementId: string; rect: Rect }[],
  occupiedBadgeRects: Rect[],
  canvasWidth: number,
  canvasHeight: number,
) {
  const overflow = Math.max(0, -candidate.rect.left)
    + Math.max(0, -candidate.rect.top)
    + Math.max(0, candidate.rect.right - canvasWidth)
    + Math.max(0, candidate.rect.bottom - canvasHeight)
  const elementOverlap = elementRects.reduce((total, { elementId, rect }) => {
    const area = intersectionArea(candidate.rect, expandRect(rect, 3))
    return total + area * (elementId === candidate.elementId ? 8 : 3)
  }, 0)
  const badgeOverlap = occupiedBadgeRects.reduce((total, rect) => total + intersectionArea(candidate.rect, expandRect(rect, 4)) * 10, 0)
  const sidePreference = candidate.placement === 'right'
    ? 0
    : candidate.placement === 'bottom'
      ? 0.25
      : candidate.placement === 'top'
        ? 0.5
        : 0.75

  return overflow * 100_000 + elementOverlap + badgeOverlap + candidate.alignmentShift * 0.05 + sidePreference
}

function getRotatedElementRect(element: LabelElement, scale: number): Rect {
  const width = element.width * scale
  const height = element.height * scale
  const radians = (element.rotation * Math.PI) / 180
  const rotatedWidth = Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians))
  const rotatedHeight = Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians))
  const centerX = (element.x + element.width / 2) * scale
  const centerY = (element.y + element.height / 2) * scale
  const left = centerX - rotatedWidth / 2
  const top = centerY - rotatedHeight / 2

  return { left, top, right: left + rotatedWidth, bottom: top + rotatedHeight, width: rotatedWidth, height: rotatedHeight }
}

function estimateBadgeWidth(value: string) {
  const contentWidth = Array.from(value).reduce((width, character) => width + (character.codePointAt(0)! > 0xff ? 11 : 6.5), 0)
  return clamp(Math.ceil(contentWidth + 18), 36, maximumBadgeWidth)
}

function intersectionArea(left: Rect, right: Rect) {
  const width = Math.max(0, Math.min(left.right, right.right) - Math.max(left.left, right.left))
  const height = Math.max(0, Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top))
  return width * height
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    left: rect.left - amount,
    top: rect.top - amount,
    right: rect.right + amount,
    bottom: rect.bottom + amount,
    width: rect.width + amount * 2,
    height: rect.height + amount * 2,
  }
}

function uniqueNumbers(values: number[]) {
  return [...new Set(values.map((value) => Math.round(value * 10) / 10))]
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}
