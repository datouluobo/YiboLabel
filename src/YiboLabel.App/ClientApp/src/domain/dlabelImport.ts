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

type DlabelPaperLayout = {
  widthMm: number
  heightMm: number
  rotation: number
  sourceWidthMm: number
  sourceHeightMm: number
}

export type DlabelImportResult = {
  document: LabelDocument
  warnings: string[]
}

export type DlabelImportDependencies = {
  minDocumentSizeMm: number
  minElementSizeMm: number
  defaultFontFamily: string
  createBlankDocument: (name?: string) => LabelDocument
  createElement: (type: LabelElement['type'], document: LabelDocument, seed?: Partial<LabelElement>) => LabelElement
  normalizeDocument: (document: LabelDocument) => LabelDocument
  normalizeRotation: (rotation: number) => number
  clamp: (value: number, min: number, max: number) => number
  createId: () => string
}

export function importDlabelTemplate(source: string, fileName: string, dependencies: DlabelImportDependencies): DlabelImportResult {
  const xml = sanitizeDlabelXml(source)
  const parser = new DOMParser()
  const documentNode = parser.parseFromString(xml, 'application/xml')
  const parserError = documentNode.querySelector('parsererror')
  if (parserError) {
    throw new Error('DDL 文件结构无法解析。')
  }

  const paper = documentNode.querySelector('paper')
  if (!paper) {
    throw new Error('DDL 文件中缺少 paper 节点。')
  }

  const paperLayout = readDlabelPaperLayout(paper, dependencies)
  const baseName = fileName.replace(/\.[^.]+$/, '').trim() || '导入标签'
  const warnings: string[] = []
  let unsupportedCount = 0

  const elements = Array.from(documentNode.querySelectorAll('labelobjects > drawobj'))
    .sort((left, right) => readDlabelNumber(left, 'zvalue', 0) - readDlabelNumber(right, 'zvalue', 0))
    .map((node, index) => parseDlabelObject(node, index, paperLayout, dependencies))
    .flatMap((result) => {
      if (!result) {
        unsupportedCount += 1
        return []
      }

      return [result]
    })

  if (unsupportedCount > 0) {
    warnings.push(`跳过 ${unsupportedCount} 个暂不支持的元素`)
  }

  const importedElements =
    elements.length > 0 ? elements : [dependencies.createElement('text', dependencies.createBlankDocument(baseName), { text: '空白导入模板' })]

  if (elements.length === 0) {
    warnings.push('未识别到可导入元素，已创建空白标签')
  }

  return {
    document: dependencies.normalizeDocument({
      name: baseName,
      widthMm: paperLayout.widthMm,
      heightMm: paperLayout.heightMm,
      copies: 1,
      darkness: 8,
      gapMm: 2,
      printRotation: 0,
      printInvert: false,
      printOffsetXMm: 0,
      printOffsetYMm: 0,
      elements: importedElements,
    }),
    warnings,
  }
}

function sanitizeDlabelXml(source: string) {
  return source.replace(/\s+previewimage="[\s\S]*?"(?=\s*>)/, '')
}

function readDlabelPaperLayout(node: Element, dependencies: DlabelImportDependencies): DlabelPaperLayout {
  const sourceWidthMm = Math.max(dependencies.minDocumentSizeMm, readDlabelNumber(node, 'w', 40))
  const sourceHeightMm = Math.max(dependencies.minDocumentSizeMm, readDlabelNumber(node, 'h', 30))
  const rotation = dependencies.normalizeRotation(readDlabelNumber(node, 'rotate', 0))

  return rotation === 90 || rotation === 270
    ? {
        widthMm: sourceHeightMm,
        heightMm: sourceWidthMm,
        rotation,
        sourceWidthMm,
        sourceHeightMm,
      }
    : {
        widthMm: sourceWidthMm,
        heightMm: sourceHeightMm,
        rotation,
        sourceWidthMm,
        sourceHeightMm,
      }
}

function transformDlabelRect(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  paperLayout: DlabelPaperLayout,
  dependencies: DlabelImportDependencies,
) {
  if (paperLayout.rotation === 90) {
    return {
      x: paperLayout.sourceHeightMm - y,
      y: x,
      width,
      height,
      rotation: dependencies.normalizeRotation(rotation + 90),
    }
  }

  if (paperLayout.rotation === 180) {
    return {
      x: paperLayout.sourceWidthMm - x - width,
      y: paperLayout.sourceHeightMm - y - height,
      width,
      height,
      rotation: dependencies.normalizeRotation(rotation + 180),
    }
  }

  if (paperLayout.rotation === 270) {
    return {
      x: y,
      y: paperLayout.sourceWidthMm - x - width,
      width,
      height,
      rotation: dependencies.normalizeRotation(rotation + 270),
    }
  }

  return { x, y, width, height, rotation }
}

function transformDlabelPoint(x: number, y: number, paperLayout: DlabelPaperLayout) {
  if (paperLayout.rotation === 90) {
    return {
      x: paperLayout.sourceHeightMm - y,
      y: x,
    }
  }

  if (paperLayout.rotation === 180) {
    return {
      x: paperLayout.sourceWidthMm - x,
      y: paperLayout.sourceHeightMm - y,
    }
  }

  if (paperLayout.rotation === 270) {
    return {
      x: y,
      y: paperLayout.sourceWidthMm - x,
    }
  }

  return { x, y }
}

function parseDlabelObject(
  node: Element,
  index: number,
  paperLayout: DlabelPaperLayout,
  dependencies: DlabelImportDependencies,
): LabelElement | null {
  const itemType = node.getAttribute('itemtype') ?? ''
  const rawX = readDlabelNumber(node, 'l', 0)
  const rawY = readDlabelNumber(node, 't', 0)
  const rawWidth = Math.max(dependencies.minElementSizeMm, readDlabelNumber(node, 'w', 10))
  const rawHeight = Math.max(dependencies.minElementSizeMm, readDlabelNumber(node, 'h', 5))
  const rawRotation = dependencies.normalizeRotation(readDlabelNumber(node, 'rotate', 0))
  const transformed = transformDlabelRect(rawX, rawY, rawWidth, rawHeight, rawRotation, paperLayout, dependencies)
  const x = dependencies.clamp(transformed.x, 0, paperLayout.widthMm)
  const y = dependencies.clamp(transformed.y, 0, paperLayout.heightMm)
  const width = dependencies.clamp(transformed.width, dependencies.minElementSizeMm, paperLayout.widthMm)
  const height = dependencies.clamp(transformed.height, dependencies.minElementSizeMm, paperLayout.heightMm)
  const rotation = transformed.rotation

  if (itemType === '5') {
    const textNode = node.querySelector('textlist > text')
    return {
      id: dependencies.createId(),
      type: 'text',
      name: 'DDL 文本',
      x,
      y,
      width,
      height,
      rotation,
      zIndex: index,
      text: textNode?.getAttribute('value') ?? '',
      fontSize: dependencies.clamp(Math.round(readDlabelNumber(node, 'fontsize', 18)), 4, 96),
      fontFamily: dependencies.defaultFontFamily,
      bold: (node.getAttribute('fontbold') ?? '').toLowerCase() === 'true',
      align: mapDlabelTextAlign(node.getAttribute('alignment')),
    } satisfies TextElement
  }

  if (itemType === '7') {
    const textNode = node.querySelector('textlist > text')
    const value = textNode?.getAttribute('value') ?? ''
    const barcodeType = (node.getAttribute('barcodetype') ?? '').trim()
    if (/qr/i.test(barcodeType)) {
      const size = dependencies.clamp(
        Math.max(width, height),
        dependencies.minElementSizeMm,
        Math.min(paperLayout.widthMm, paperLayout.heightMm),
      )
      return {
        id: dependencies.createId(),
        type: 'qrcode',
        name: 'DDL 二维码',
        x,
        y,
        width: size,
        height: size,
        rotation,
        zIndex: index,
        value,
        showHumanReadable: false,
        textPosition: 'bottom',
        humanReadableFontSize: 12,
        humanReadableFontFamily: dependencies.defaultFontFamily,
      } satisfies QrCodeElement
    }

    return {
      id: dependencies.createId(),
      type: 'barcode',
      name: 'DDL 条码',
      x,
      y,
      width,
      height,
      rotation,
      zIndex: index,
      value,
      symbology: normalizeDlabelBarcode(barcodeType),
      showHumanReadable: (node.getAttribute('textposition') ?? '0') !== '-1',
      textPosition: 'bottom',
      humanReadableFontSize: 12,
      humanReadableFontFamily: dependencies.defaultFontFamily,
    } satisfies BarcodeElement
  }

  if (itemType === '1') {
    return parseDlabelLine(node, index, paperLayout, dependencies)
  }

  if (itemType === '2' || itemType === '3') {
    const thickness = Math.max(1, Math.round(readDlabelNumber(node, 'linewidth', readDlabelNumber(node, 'thickness', 1))))
    return {
      id: dependencies.createId(),
      type: 'rectangle',
      name: 'DDL 矩形',
      x,
      y,
      width,
      height,
      rotation,
      zIndex: index,
      thickness,
    } satisfies RectangleElement
  }

  if (itemType === '6' || itemType === '8' || itemType === '9') {
    const imageDataUrl = extractDlabelImage(node)
    if (imageDataUrl) {
      return {
        id: dependencies.createId(),
        type: 'image',
        name: 'DDL 图片',
        x,
        y,
        width,
        height,
        rotation,
        zIndex: index,
        dataUrl: imageDataUrl,
        invert: false,
      } satisfies ImageElement
    }
  }

  const imageDataUrl = extractDlabelImage(node)
  if (imageDataUrl) {
    return {
      id: dependencies.createId(),
      type: 'image',
      name: 'DDL 图片',
      x,
      y,
      width,
      height,
      rotation,
      zIndex: index,
      dataUrl: imageDataUrl,
      invert: false,
    } satisfies ImageElement
  }

  return null
}

function parseDlabelLine(
  node: Element,
  index: number,
  paperLayout: DlabelPaperLayout,
  dependencies: DlabelImportDependencies,
): LineElement {
  const lineWidth = Math.max(1, Math.round(readDlabelNumber(node, 'linewidth', readDlabelNumber(node, 'thickness', 1))))
  const degree = dependencies.normalizeRotation(readDlabelNumber(node, 'linedegree', readDlabelNumber(node, 'rotate', 0)) + paperLayout.rotation)
  const startX = readDlabelNumber(node, 'linestartx', readDlabelNumber(node, 'l', 0))
  const startY = readDlabelNumber(node, 'linestarty', readDlabelNumber(node, 't', 0))
  const lineLength = Math.max(
    dependencies.minElementSizeMm,
    readDlabelNumber(node, 'linelength', Math.max(readDlabelNumber(node, 'w', 1), readDlabelNumber(node, 'h', 1))),
  )
  const transformedStart = transformDlabelPoint(startX, startY, paperLayout)
  const lineVisualThickness = Math.max(dependencies.minElementSizeMm, readDlabelNumber(node, 'w', readDlabelNumber(node, 'h', 1.2)))
  const horizontalDelta = degree === 180 ? -lineLength : lineLength
  const verticalDelta = degree === 270 ? -lineLength : lineLength

  if (degree === 90 || degree === 270) {
    return {
      id: dependencies.createId(),
      type: 'line',
      name: 'DDL 竖线',
      x: dependencies.clamp(transformedStart.x - lineVisualThickness / 2, 0, paperLayout.widthMm),
      y: dependencies.clamp(Math.min(transformedStart.y, transformedStart.y + verticalDelta), 0, paperLayout.heightMm),
      width: dependencies.clamp(lineVisualThickness, dependencies.minElementSizeMm, paperLayout.widthMm),
      height: dependencies.clamp(lineLength, dependencies.minElementSizeMm, paperLayout.heightMm),
      rotation: 0,
      zIndex: index,
      thickness: lineWidth,
    }
  }

  return {
    id: dependencies.createId(),
    type: 'line',
    name: 'DDL 横线',
    x: dependencies.clamp(Math.min(transformedStart.x, transformedStart.x + horizontalDelta), 0, paperLayout.widthMm),
    y: dependencies.clamp(transformedStart.y - lineVisualThickness / 2, 0, paperLayout.heightMm),
    width: dependencies.clamp(lineLength, dependencies.minElementSizeMm, paperLayout.widthMm),
    height: dependencies.clamp(lineVisualThickness, dependencies.minElementSizeMm, paperLayout.heightMm),
    rotation: 0,
    zIndex: index,
    thickness: lineWidth,
  }
}

function readDlabelNumber(node: Element, attributeName: string, fallback: number) {
  const raw = node.getAttribute(attributeName)
  if (!raw) {
    return fallback
  }

  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function mapDlabelTextAlign(alignment: string | null): TextElement['align'] {
  if (alignment === '1' || alignment === '2') {
    return 'center'
  }

  if (alignment === '3') {
    return 'right'
  }

  return 'left'
}

function normalizeDlabelBarcode(barcodeType: string) {
  const normalized = barcodeType.replace(/[_\s-]/g, '').toUpperCase()
  if (normalized === 'CODE128') {
    return '128'
  }

  if (normalized === 'CODE39') {
    return '39'
  }

  return normalized || '128'
}

function extractDlabelImage(node: Element) {
  const attributes = node.getAttributeNames()
  for (const attributeName of attributes) {
    const value = node.getAttribute(attributeName)
    if (!value) {
      continue
    }

    if (/^data:image\//i.test(value)) {
      return value
    }

    if (/base64/i.test(attributeName) && !value.includes('<')) {
      return `data:image/png;base64,${value.replace(/\s+/g, '')}`
    }
  }

  const candidates = Array.from(node.children)
  for (const child of candidates) {
    for (const attributeName of child.getAttributeNames()) {
      const value = child.getAttribute(attributeName)
      if (!value) {
        continue
      }

      if (/^data:image\//i.test(value)) {
        return value
      }

      if (/base64/i.test(attributeName) && !value.includes('<')) {
        return `data:image/png;base64,${value.replace(/\s+/g, '')}`
      }
    }
  }

  return ''
}
