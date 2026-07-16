import type { BarcodeElement, QrCodeElement } from '../types'
import { pointsToMm } from './labelDocument'

export type Rect = {
  x: number
  y: number
  width: number
  height: number
}

export type CodeElementLayout = {
  code: Rect
  text: Rect | null
  fontSize: number
}

export function getHumanReadableFontSize(fontSize: number, pixelsPerMm: number) {
  return Math.max(1, pointsToMm(fontSize) * pixelsPerMm)
}

export function getBarcodeLayout(element: BarcodeElement, width: number, height: number, pixelsPerMm: number): CodeElementLayout {
  return getCodeElementLayout({
    width,
    height,
    showText: element.showHumanReadable,
    textPosition: element.textPosition,
    requestedFontSize: getHumanReadableFontSize(element.humanReadableFontSize, pixelsPerMm),
    squareCode: false,
  })
}

export function getQrCodeLayout(element: QrCodeElement, width: number, height: number, pixelsPerMm: number): CodeElementLayout {
  return getCodeElementLayout({
    width,
    height,
    showText: element.showHumanReadable,
    textPosition: element.textPosition,
    requestedFontSize: getHumanReadableFontSize(element.humanReadableFontSize, pixelsPerMm),
    squareCode: true,
  })
}

function getCodeElementLayout({
  width,
  height,
  showText,
  textPosition,
  requestedFontSize,
  squareCode,
}: {
  width: number
  height: number
  showText: boolean
  textPosition: 'bottom' | 'top'
  requestedFontSize: number
  squareCode: boolean
}): CodeElementLayout {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)

  if (!showText) {
    return {
      code: fitCodeRect({ x: 0, y: 0, width: safeWidth, height: safeHeight }, squareCode),
      text: null,
      fontSize: requestedFontSize,
    }
  }

  const verticalPadding = 2
  const gap = 0
  const naturalTextBlockHeight = requestedFontSize * 1.18 + verticalPadding * 2
  const textBlockHeight = Math.min(safeHeight, naturalTextBlockHeight)
  const remainingHeight = Math.max(1, safeHeight - textBlockHeight - gap)
  const codeBounds = textPosition === 'top'
    ? { x: 0, y: textBlockHeight + gap, width: safeWidth, height: remainingHeight }
    : { x: 0, y: 0, width: safeWidth, height: remainingHeight }
  const text = textPosition === 'top'
    ? { x: 0, y: 0, width: safeWidth, height: textBlockHeight }
    : { x: 0, y: safeHeight - textBlockHeight, width: safeWidth, height: textBlockHeight }

  return {
    code: fitCodeRect(codeBounds, squareCode),
    text,
    fontSize: requestedFontSize,
  }
}

function fitCodeRect(bounds: Rect, squareCode: boolean): Rect {
  if (!squareCode) {
    return bounds
  }

  const size = Math.max(1, Math.min(bounds.width, bounds.height))
  return {
    x: bounds.x + (bounds.width - size) / 2,
    y: bounds.y + (bounds.height - size) / 2,
    width: size,
    height: size,
  }
}
