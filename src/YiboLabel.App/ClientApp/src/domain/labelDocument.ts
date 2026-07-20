import type {
  BarcodeElement,
  ImageElement,
  LabelDocument,
  LabelElement,
  LineElement,
  QrCodeElement,
  RectangleElement,
  TextElement,
} from '../types'

export const minDocumentSizeMm = 20
export const minElementSizeMm = 0.8
export const defaultFontFamily = 'Microsoft YaHei'

export const createId = () => crypto.randomUUID()

export const getDefaultElementName = (type: LabelElement['type']) =>
  type === 'text'
    ? '文本'
    : type === 'barcode'
      ? '条码'
      : type === 'qrcode'
        ? '二维码'
        : type === 'line'
          ? '线条'
          : type === 'rectangle'
            ? '矩形'
            : '图片'

export const createBlankDocument = (name = '未命名标签'): LabelDocument =>
  normalizeDocument({
    name,
    widthMm: 40,
    heightMm: 30,
    sourceSpecId: null,
    sourceSpecName: '默认 40 x 30 mm',
    copies: 1,
    darkness: 8,
    gapMm: 2,
    printRotation: 0,
    printInvert: false,
    printOffsetXMm: 0,
    printOffsetYMm: 0,
    calibrationPrinterDevicePath: null,
    calibrationProfileId: null,
    printCalibrationState: 'unset',
    printCalibrationLabel: null,
    lastPrintCheckSignature: null,
    elements: [
      {
        id: createId(),
        name: '标题',
        type: 'text',
        x: 3,
        y: 3,
        width: 18,
        height: 6,
        rotation: 0,
        text: 'YiboLabel',
        fontSize: 24,
        fontFamily: defaultFontFamily,
        bold: true,
        italic: false,
        align: 'left',
      },
    ],
  })

export function createElement(type: LabelElement['type'], document: LabelDocument, seed?: Partial<LabelElement>): LabelElement {
  const base = {
    id: createId(),
    name: getDefaultElementName(type),
    x: clamp(document.widthMm * 0.1, 2, Math.max(2, document.widthMm - 16)),
    y: clamp(document.heightMm * 0.12, 2, Math.max(2, document.heightMm - 12)),
    width: 14,
    height: 6,
    rotation: 0,
    locked: false,
    hidden: false,
    zIndex: document.elements.length,
  }

  const next =
    type === 'text'
      ? { ...base, type, text: '新文本', fontSize: 22, fontFamily: defaultFontFamily, bold: false, italic: false, align: 'left' as const }
      : type === 'barcode'
        ? { ...base, type, width: 28, height: 10, value: '1234567890', symbology: '128', showHumanReadable: true, textPosition: 'bottom' as const, humanReadableFontSize: 12, humanReadableFontFamily: defaultFontFamily }
        : type === 'qrcode'
          ? { ...base, type, width: 10, height: 10, value: 'https://yibo.local', showHumanReadable: false, textPosition: 'bottom' as const, humanReadableFontSize: 12, humanReadableFontFamily: defaultFontFamily }
          : type === 'line'
            ? { ...base, type, width: 20, height: 0.8, thickness: 2 }
            : type === 'rectangle'
              ? { ...base, type, width: 18, height: 12, thickness: 1 }
              : { ...base, type, width: 16, height: 12, dataUrl: '', invert: false }

  return normalizeElement({ ...next, ...seed } as LabelElement, document, document.elements.length)
}

export function normalizeDocument(document: LabelDocument): LabelDocument {
  const widthMm = clamp(roundTo(document.widthMm || 40, 0.1), minDocumentSizeMm, 200)
  const heightMm = clamp(roundTo(document.heightMm || 30, 0.1), minDocumentSizeMm, 200)
  const base: LabelDocument = {
    ...document,
    name: document.name || '未命名标签',
    widthMm,
    heightMm,
    sourceSpecId: document.sourceSpecId ?? null,
    sourceSpecName: document.sourceSpecName?.trim() || null,
    copies: clamp(Math.round(document.copies || 1), 1, 99),
    darkness: clamp(roundTo(document.darkness || 8, 0.1), 1, 15),
    gapMm: clamp(roundTo(document.gapMm || 2, 0.1), 0, 20),
    printRotation: normalizePrintRotation(document.printRotation),
    printInvert: Boolean(document.printInvert),
    printOffsetXMm: clamp(roundTo(document.printOffsetXMm ?? 0, 0.1), -20, 20),
    printOffsetYMm: clamp(roundTo(document.printOffsetYMm ?? 0, 0.1), -20, 20),
    calibrationPrinterDevicePath: document.calibrationPrinterDevicePath ?? null,
    calibrationProfileId: document.calibrationProfileId ?? null,
    printCalibrationState: normalizePrintCalibrationState(document.printCalibrationState),
    printCalibrationLabel: document.printCalibrationLabel?.trim() || null,
    lastPrintCheckSignature: document.lastPrintCheckSignature?.trim() || null,
    elements: [],
  }

  base.elements = (document.elements ?? []).map((element, index) => normalizeElement(element, base, index))
  return { ...base, elements: normalizeLayerOrder(base.elements) }
}

export function normalizeElement(element: LabelElement, document: LabelDocument, index: number): LabelElement {
  const normalizedType = coerceElementType(element)
  const widthLimit = Math.max(minElementSizeMm, document.widthMm)
  const heightLimit = Math.max(minElementSizeMm, document.heightMm)
  const width = clamp(roundTo(element.width || minElementSizeMm, 0.1), minElementSizeMm, widthLimit)
  const unclampedHeight = clamp(roundTo(element.height || minElementSizeMm, 0.1), minElementSizeMm, heightLimit)
  const x = clamp(roundTo(element.x || 0, 0.1), 0, Math.max(0, document.widthMm - width))
  const defaultHeight = normalizedType === 'line' ? 0.8 : unclampedHeight
  const height = clamp(roundTo(defaultHeight, 0.1), minElementSizeMm, heightLimit)
  const y = clamp(roundTo(element.y || 0, 0.1), 0, Math.max(0, document.heightMm - height))
  const common = {
    ...element,
    type: normalizedType,
    name: element.name?.trim() || getDefaultElementName(element.type),
    x,
    y,
    width,
    height,
    rotation: normalizeRotation(element.rotation),
    locked: Boolean(element.locked),
    hidden: Boolean(element.hidden),
    zIndex: element.zIndex ?? index,
    lexiconGroupIds: [...new Set(element.lexiconGroupIds ?? [])],
    defaultLexiconGroupId: element.defaultLexiconGroupId ?? null,
  }

  if (normalizedType === 'text') {
    const textElement = element as Partial<TextElement>
    return {
      ...common,
      text: textElement.text ?? '',
      fontSize: clamp(Math.round(textElement.fontSize || 22), 4, 96),
      fontFamily: normalizeFontFamily(textElement.fontFamily),
      bold: Boolean(textElement.bold),
      italic: Boolean(textElement.italic),
      align: textElement.align === 'center' || textElement.align === 'right' ? textElement.align : 'left',
    } as TextElement
  }

  if (normalizedType === 'barcode') {
    const barcodeElement = element as Partial<BarcodeElement>
    return {
      ...common,
      value: barcodeElement.value ?? '',
      symbology: barcodeElement.symbology?.trim() || '128',
      showHumanReadable: Boolean(barcodeElement.showHumanReadable),
      textPosition: barcodeElement.textPosition === 'top' ? 'top' : 'bottom',
      humanReadableFontSize: clamp(Math.round(barcodeElement.humanReadableFontSize || 12), 4, 36),
      humanReadableFontFamily: normalizeFontFamily(barcodeElement.humanReadableFontFamily),
    } as BarcodeElement
  }

  if (normalizedType === 'qrcode') {
    const qrElement = element as Partial<QrCodeElement>
    const humanReadableFontSize = clamp(Math.round(qrElement.humanReadableFontSize || 12), 4, 36)
    const showHumanReadable = Boolean(qrElement.showHumanReadable)
    const textHeight = showHumanReadable ? getQrTextHeightMm(humanReadableFontSize) : 0
    const maxCoreSize = Math.max(minElementSizeMm, Math.min(document.widthMm, document.heightMm - textHeight))
    const coreSize = clamp(roundTo(common.width, 0.1), minElementSizeMm, maxCoreSize)
    const elementHeight = showHumanReadable
      ? clamp(roundTo(Math.max(common.height, coreSize + textHeight), 0.1), coreSize + textHeight, document.heightMm)
      : coreSize
    return {
      ...common,
      width: coreSize,
      height: elementHeight,
      x: clamp(common.x, 0, Math.max(0, document.widthMm - coreSize)),
      y: clamp(common.y, 0, Math.max(0, document.heightMm - elementHeight)),
      value: qrElement.value ?? '',
      showHumanReadable,
      textPosition: qrElement.textPosition === 'top' ? 'top' : 'bottom',
      humanReadableFontSize,
      humanReadableFontFamily: normalizeFontFamily(qrElement.humanReadableFontFamily),
    } as QrCodeElement
  }

  if (normalizedType === 'line') {
    const lineElement = element as Partial<LineElement>
    return {
      ...common,
      height: clamp(common.height, minElementSizeMm, document.heightMm),
      thickness: clamp(Math.round(lineElement.thickness || 1), 1, 8),
    } as LineElement
  }

  if (normalizedType === 'rectangle') {
    const rectangleElement = element as Partial<RectangleElement>
    return {
      ...common,
      thickness: clamp(Math.round(rectangleElement.thickness || 1), 1, 8),
    } as RectangleElement
  }

  const imageElement = element as Partial<ImageElement>
  return {
    ...common,
    type: 'image',
    dataUrl: imageElement.dataUrl ?? '',
    invert: Boolean(imageElement.invert),
  } as ImageElement
}

function coerceElementType(element: Partial<LabelElement>) {
  if (
    element.type === 'text'
    || element.type === 'barcode'
    || element.type === 'qrcode'
    || element.type === 'line'
    || element.type === 'rectangle'
    || element.type === 'image'
  ) {
    return element.type
  }

  if ('text' in element) {
    return 'text'
  }

  if ('dataUrl' in element) {
    return 'image'
  }

  if ('value' in element) {
    return 'symbology' in element ? 'barcode' : 'qrcode'
  }

  if ('thickness' in element) {
    return (element.width ?? 0) <= 1.5 || (element.height ?? 0) <= 1.5 ? 'line' : 'rectangle'
  }

  return 'text'
}

export function normalizeLayerOrder(elements: LabelElement[]) {
  return [...elements]
    .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0) || left.id.localeCompare(right.id))
    .map((element, index) => ({ ...element, zIndex: index }))
}

export function assignLayerOrder(elements: LabelElement[]) {
  return elements.map((element, index) => ({ ...element, zIndex: index }))
}

export function reindexElements(elements: LabelElement[]) {
  return normalizeLayerOrder(elements)
}

export function sortElementsByLayer(elements: LabelElement[]) {
  return [...elements].sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0) || left.id.localeCompare(right.id))
}

export function sortElements(elements: LabelElement[]) {
  return sortElementsByLayer(elements)
}

export function sortElementsByListOrder(elements: LabelElement[]) {
  return [...sortElementsByLayer(elements)].reverse()
}

function assignZIndexFromListOrder(elements: LabelElement[]) {
  return assignLayerOrder([...elements].reverse())
}

export function moveElementBefore(elements: LabelElement[], movingId: string, anchorId: string) {
  if (movingId === anchorId) {
    return normalizeLayerOrder(elements)
  }

  const ordered = sortElementsByListOrder(elements)
  const moving = ordered.find((element) => element.id === movingId)
  if (!moving) {
    return normalizeLayerOrder(elements)
  }

  const withoutMoving = ordered.filter((element) => element.id !== movingId)
  const anchorIndex = withoutMoving.findIndex((element) => element.id === anchorId)
  if (anchorIndex < 0) {
    return normalizeLayerOrder(elements)
  }

  withoutMoving.splice(anchorIndex, 0, moving)
  return assignZIndexFromListOrder(withoutMoving)
}

export function moveElementAfter(elements: LabelElement[], movingId: string, anchorId: string) {
  if (movingId === anchorId) {
    return normalizeLayerOrder(elements)
  }

  const ordered = sortElementsByListOrder(elements)
  const moving = ordered.find((element) => element.id === movingId)
  if (!moving) {
    return normalizeLayerOrder(elements)
  }

  const withoutMoving = ordered.filter((element) => element.id !== movingId)
  const anchorIndex = withoutMoving.findIndex((element) => element.id === anchorId)
  if (anchorIndex < 0) {
    return normalizeLayerOrder(elements)
  }

  withoutMoving.splice(anchorIndex + 1, 0, moving)
  return assignZIndexFromListOrder(withoutMoving)
}

export function serializeDocument(document: LabelDocument) {
  return JSON.stringify(normalizeDocument(document))
}

export function parseSerializedDocument(serialized: string) {
  try {
    const parsed = JSON.parse(serialized) as LabelDocument | { document?: LabelDocument }
    if ('document' in parsed && parsed.document) {
      return normalizeDocument(parsed.document)
    }

    return normalizeDocument(parsed as LabelDocument)
  } catch {
    return null
  }
}

export function normalizeRotation(rotation: number) {
  const normalized = ((rotation % 360) + 360) % 360
  return roundTo(normalized, 1)
}

export function normalizePrintRotation(rotation: number | undefined) {
  const normalized = ((Math.round((rotation ?? 0) / 90) * 90) % 360 + 360) % 360
  return normalized
}

function normalizePrintCalibrationState(state: LabelDocument['printCalibrationState']) {
  if (state === 'default' || state === 'calibrated' || state === 'unconfirmed') {
    return state
  }

  return 'unset'
}

export function roundTo(value: number, step: number) {
  return Math.round(value / step) * step
}

export function pointsToMm(points: number) {
  return points * 0.352778
}

export function getQrTextHeightMm(fontSize: number) {
  return roundTo(pointsToMm(fontSize) * 1.28, 0.1)
}

export function getQrTextAreaHeightMm(element: Pick<QrCodeElement, 'showHumanReadable' | 'humanReadableFontSize'>) {
  return element.showHumanReadable ? getQrTextHeightMm(element.humanReadableFontSize) : 0
}

export function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min
  }

  return Math.min(Math.max(value, min), max)
}

export function getLayerMeta(element: LabelElement) {
  const value =
    element.type === 'text'
      ? element.text
      : element.type === 'barcode' || element.type === 'qrcode'
        ? element.value
        : element.type === 'line'
          ? '线条'
          : element.type === 'rectangle'
            ? '矩形'
            : '图片'
  return `${getDefaultElementName(element.type)} · ${value || '空'}`
}

export function normalizeFontFamily(fontFamily: string | null | undefined) {
  const normalized = fontFamily?.trim()
  return normalized || defaultFontFamily
}

export function getElementOrderLabel(element: LabelElement, elementCount: number) {
  if (elementCount <= 1) {
    return '唯一元素'
  }

  const zIndex = element.zIndex ?? 0
  if (zIndex >= elementCount - 1) {
    return '最上方'
  }
  if (zIndex <= 0) {
    return '最下方'
  }
  return '中间'
}

export function isLexiconEnabledElement(element: LabelElement | null): element is TextElement | BarcodeElement | QrCodeElement {
  return element?.type === 'text' || element?.type === 'barcode' || element?.type === 'qrcode'
}

export function createContentPatch(element: TextElement | BarcodeElement | QrCodeElement, value: string): Partial<LabelElement> {
  return element.type === 'text' ? ({ text: value } as Partial<TextElement>) : ({ value } as Partial<BarcodeElement | QrCodeElement>)
}
