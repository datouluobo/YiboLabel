import JsBarcode from 'jsbarcode'
import QRCode from 'qrcode'
import {
  defaultFontFamily,
  getQrTextAreaHeightMm,
  minElementSizeMm,
  normalizeFontFamily,
  pointsToMm,
} from './labelDocument'
import type { BarcodeElement, ImageElement, LabelDocument, LabelElement, QrCodeElement, TextElement } from '../types'

const defaultExportDpi = 203
type PdfPaperMode = 'label' | 'a4-portrait' | 'a4-landscape'

export async function renderLabelCanvasElementToDataUrl(
  labelCanvas: HTMLDivElement,
  labelDocument: LabelDocument,
  format: 'png' | 'jpg',
  dpi = defaultExportDpi,
) {
  const sourceWidth = Math.max(1, labelCanvas.getBoundingClientRect().width)
  const sourceHeight = Math.max(1, labelCanvas.getBoundingClientRect().height)
  const targetWidth = Math.max(1, Math.round(labelDocument.widthMm * dpi / 25.4))
  const targetHeight = Math.max(1, Math.round(labelDocument.heightMm * dpi / 25.4))
  const clone = labelCanvas.cloneNode(true) as HTMLDivElement

  prepareClonedLabelCanvas(labelCanvas, clone)

  const styleText = collectDocumentStyles()
  const serialized = new XMLSerializer().serializeToString(clone)
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${sourceWidth}" height="${sourceHeight}" viewBox="0 0 ${sourceWidth} ${sourceHeight}">
  <foreignObject width="100%" height="100%">
    <div xmlns="http://www.w3.org/1999/xhtml">
      <style>${styleText}</style>
      ${serialized}
    </div>
  </foreignObject>
</svg>`

  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`)
  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('无法创建图片导出画布。')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, targetWidth, targetHeight)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, 0, 0, targetWidth, targetHeight)
  return canvas.toDataURL(format === 'png' ? 'image/png' : 'image/jpeg', format === 'jpg' ? 0.92 : undefined)
}

export async function renderLabelDocumentToPdfBase64(
  _labelCanvas: HTMLDivElement,
  labelDocument: LabelDocument,
  paperMode: PdfPaperMode,
) {
  const pageSize = getPdfPageSize(labelDocument, paperMode)
  const pageWidthPt = mmToPt(pageSize.widthMm)
  const pageHeightPt = mmToPt(pageSize.heightMm)
  const labelWidthPt = mmToPt(labelDocument.widthMm)
  const labelHeightPt = mmToPt(labelDocument.heightMm)
  const labelX = (pageWidthPt - labelWidthPt) / 2
  const labelY = (pageHeightPt - labelHeightPt) / 2
  const imageResources: PdfImageResource[] = []
  const contentParts = [
    'q',
    `${formatPdfNumber(1)} 0 0 ${formatPdfNumber(1)} ${formatPdfNumber(labelX)} ${formatPdfNumber(labelY)} cm`,
  ]

  const elements = labelDocument.elements
    .filter((element) => !element.hidden)
    .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0) || left.id.localeCompare(right.id))

  for (const element of elements) {
    contentParts.push(await renderPdfElement(element, labelDocument, imageResources))
  }

  contentParts.push('Q', '')

  return bytesToBase64(buildPdfBytes({
    pageWidthPt,
    pageHeightPt,
    content: contentParts.join('\n'),
    imageResources,
  }))
}

export async function renderLabelDocumentToDataUrl(labelDocument: LabelDocument, format: 'png' | 'jpg', dpi = defaultExportDpi) {
  const pixelsPerMm = dpi / 25.4
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(labelDocument.widthMm * pixelsPerMm))
  canvas.height = Math.max(1, Math.round(labelDocument.heightMm * pixelsPerMm))

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('无法创建图片导出画布。')
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  const elements = labelDocument.elements
    .filter((element) => !element.hidden)
    .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0) || left.id.localeCompare(right.id))

  for (const element of elements) {
    await renderElement(context, element, pixelsPerMm)
  }

  return canvas.toDataURL(format === 'png' ? 'image/png' : 'image/jpeg', format === 'jpg' ? 0.92 : undefined)
}

function prepareClonedLabelCanvas(source: HTMLDivElement, clone: HTMLDivElement) {
  clone.querySelectorAll('.grid-overlay, .selection-outline, .snap-line, .marquee-box').forEach((element) => element.remove())
  clone.querySelectorAll('.canvas-element').forEach((element) => {
    element.classList.remove('selected', 'locked')
    ;(element as HTMLElement).style.borderColor = 'transparent'
    ;(element as HTMLElement).style.background = 'transparent'
  })

  const sourceCanvases = [...source.querySelectorAll('canvas')]
  const clonedCanvases = [...clone.querySelectorAll('canvas')]
  clonedCanvases.forEach((canvas, index) => {
    const sourceCanvas = sourceCanvases[index]
    if (!sourceCanvas) {
      return
    }

    const image = document.createElement('img')
    image.src = sourceCanvas.toDataURL('image/png')
    image.className = canvas.className
    image.setAttribute('alt', '')
    image.setAttribute('style', canvas.getAttribute('style') ?? '')
    canvas.replaceWith(image)
  })
}

function collectDocumentStyles() {
  return [...document.styleSheets]
    .map((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText).join('\n')
      } catch {
        return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}

type PdfImageResource = {
  name: string
  objectId: number
  bytes: Uint8Array
  width: number
  height: number
}

async function renderPdfElement(element: LabelElement, labelDocument: LabelDocument, imageResources: PdfImageResource[]) {
  const x = mmToPt(element.x)
  const y = mmToPt(labelDocument.heightMm - element.y - element.height)
  const width = mmToPt(element.width)
  const height = mmToPt(element.height)
  const centerX = x + width / 2
  const centerY = y + height / 2
  const rotation = (element.rotation * Math.PI) / 180
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const parts = [
    'q',
    `${formatPdfNumber(cos)} ${formatPdfNumber(sin)} ${formatPdfNumber(-sin)} ${formatPdfNumber(cos)} ${formatPdfNumber(centerX)} ${formatPdfNumber(centerY)} cm`,
    `1 0 0 1 ${formatPdfNumber(-width / 2)} ${formatPdfNumber(-height / 2)} cm`,
  ]

  if (element.type === 'text') {
    parts.push(renderPdfText(element, width, height))
  } else if (element.type === 'line') {
    parts.push(renderPdfFilledRect(0, 0, width, Math.max(0.35, mmToPt(element.thickness * 0.2))))
  } else if (element.type === 'rectangle') {
    parts.push(renderPdfRectangle(width, height, Math.max(0.35, mmToPt(element.thickness * 0.12))))
  } else if (element.type === 'barcode') {
    parts.push(renderPdfBarcode(element, width, height))
  } else if (element.type === 'qrcode') {
    parts.push(renderPdfQrCode(element, width, height))
  } else if (element.type === 'image') {
    parts.push(await renderPdfImage(element, width, height, imageResources))
  }

  parts.push('Q')
  return parts.join('\n')
}

function renderPdfText(element: TextElement, width: number, height: number) {
  const fontSize = Math.max(1, element.fontSize)
  const fontWeight = element.bold ? 700 : 500
  const estimatedWidth = measurePdfTextWidth(element.text, fontSize, fontWeight, element.fontFamily)
  const fitScale = clamp(width / Math.max(1, estimatedWidth), 0.55, 1)
  const scaledWidth = estimatedWidth * fitScale
  const x = element.align === 'right'
    ? width - scaledWidth
    : element.align === 'center'
      ? (width - scaledWidth) / 2
      : 0
  const y = Math.max(0, height - fontSize * 0.92)
  return renderPdfTextRuns(element.text || ' ', fontSize, fontWeight, element.fontFamily, x, y, fitScale)
}

function renderPdfBarcode(element: BarcodeElement, width: number, height: number) {
  try {
    const encodings = getBarcodeEncodings(element)
    const moduleCount = encodings.reduce((total, encoding) => total + encoding.data.length, 0)
    const moduleWidth = width / Math.max(1, moduleCount)
    const textHeight = element.showHumanReadable ? Math.max(10, element.humanReadableFontSize * 1.25) : 0
    const barHeight = Math.max(1, height - textHeight)
    const barY = element.showHumanReadable && element.textPosition === 'bottom' ? textHeight : 0
    const textY = element.textPosition === 'top' ? height - textHeight * 0.8 : 0
    const parts: string[] = []
    let cursor = 0

    for (const encoding of encodings) {
      for (const bit of encoding.data) {
        if (bit === '1') {
          parts.push(renderPdfFilledRect(cursor, barY, moduleWidth, barHeight))
        }
        cursor += moduleWidth
      }
    }

    if (element.showHumanReadable) {
      parts.push(renderPdfCenteredText(element.value, element.humanReadableFontSize * 1.35, element.humanReadableFontFamily, width, textY))
    }

    return parts.join('\n')
  } catch {
    return renderPdfCenteredText(element.value || ' ', 10, element.humanReadableFontFamily, width, height / 2)
  }
}

function renderPdfQrCode(element: QrCodeElement, width: number, height: number) {
  const textHeightMm = getQrTextAreaHeightMm(element)
  const textHeight = mmToPt(textHeightMm)
  const coreSize = Math.max(mmToPt(minElementSizeMm), Math.min(width, height - textHeight))
  const qr = QRCode.create(element.value || ' ', { errorCorrectionLevel: 'M' })
  const moduleSize = coreSize / qr.modules.size
  const qrX = (width - coreSize) / 2
  const qrY = element.showHumanReadable && element.textPosition === 'bottom' ? textHeight : 0
  const parts: string[] = []

  for (let row = 0; row < qr.modules.size; row += 1) {
    for (let column = 0; column < qr.modules.size; column += 1) {
      if (qr.modules.data[row * qr.modules.size + column]) {
        parts.push(renderPdfFilledRect(qrX + column * moduleSize, qrY + (qr.modules.size - row - 1) * moduleSize, moduleSize, moduleSize))
      }
    }
  }

  if (element.showHumanReadable) {
    const textY = element.textPosition === 'top' ? height - textHeight * 0.8 : 0
    parts.push(renderPdfCenteredText(element.value, element.humanReadableFontSize * 1.15, element.humanReadableFontFamily, width, textY))
  }

  return parts.join('\n')
}

async function renderPdfImage(element: ImageElement, width: number, height: number, imageResources: PdfImageResource[]) {
  if (!element.dataUrl) {
    return ''
  }

  const image = await loadImage(element.dataUrl)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(image.naturalWidth || width))
  canvas.height = Math.max(1, Math.round(image.naturalHeight || height))
  const context = canvas.getContext('2d')
  if (!context) {
    return ''
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const bytes = base64ToBytes(dataUrlToBase64(canvas.toDataURL('image/jpeg', 0.92)))
  const resource = {
    name: `Im${imageResources.length}`,
    objectId: 11 + imageResources.length,
    bytes,
    width: canvas.width,
    height: canvas.height,
  }
  imageResources.push(resource)
  return [
    'q',
    `${formatPdfNumber(width)} 0 0 ${formatPdfNumber(height)} 0 0 cm`,
    `/${resource.name} Do`,
    'Q',
  ].join('\n')
}

function renderPdfFilledRect(x: number, y: number, width: number, height: number) {
  return `0 0 0 rg ${formatPdfNumber(x)} ${formatPdfNumber(y)} ${formatPdfNumber(width)} ${formatPdfNumber(height)} re f`
}

function renderPdfRectangle(width: number, height: number, lineWidth: number) {
  const inset = lineWidth / 2
  return `0 0 0 RG ${formatPdfNumber(lineWidth)} w ${formatPdfNumber(inset)} ${formatPdfNumber(inset)} ${formatPdfNumber(Math.max(0.1, width - lineWidth))} ${formatPdfNumber(Math.max(0.1, height - lineWidth))} re S`
}

function renderPdfCenteredText(text: string, fontSize: number, fontFamily: string, width: number, y: number) {
  const estimatedWidth = measurePdfTextWidth(text, fontSize, 500, fontFamily)
  const fitScale = clamp(width / Math.max(1, estimatedWidth), 0.55, 1)
  const x = (width - estimatedWidth * fitScale) / 2
  return renderPdfTextRuns(text || ' ', fontSize, 500, fontFamily, x, y, fitScale)
}

function getBarcodeEncodings(element: BarcodeElement) {
  const data: { encodings?: Array<{ data?: string }> } = {}
  JsBarcode(data, element.value || ' ', {
    format: mapBarcodeFormat(element.symbology),
    displayValue: false,
    margin: 0,
  })
  return (data.encodings ?? [])
    .map((encoding) => ({ data: encoding.data ?? '' }))
    .filter((encoding) => encoding.data.length > 0)
}

function utf16BeHex(text: string) {
  return [...text].map((character) => {
    const code = character.charCodeAt(0)
    return code.toString(16).padStart(4, '0')
  }).join('')
}

function renderPdfTextRuns(
  text: string,
  fontSize: number,
  fontWeight: number,
  fontFamily: string,
  x: number,
  y: number,
  fitScale: number,
) {
  const runs = splitPdfTextRuns(text || ' ')
  const parts = [
    'BT',
    `${formatPdfNumber(fitScale * 100)} Tz`,
    `${formatPdfNumber(x)} ${formatPdfNumber(y)} Td`,
  ]
  let activeFont = ''

  for (const run of runs) {
    const fontName = run.cjk ? '/F0' : '/F1'
    if (fontName !== activeFont) {
      parts.push(`${fontName} ${formatPdfNumber(fontSize)} Tf`)
      activeFont = fontName
    }

    parts.push(run.cjk ? `<${utf16BeHex(run.text)}> Tj` : `(${escapePdfLiteral(run.text)}) Tj`)
  }

  parts.push('ET')
  void fontWeight
  void fontFamily
  return parts.join('\n')
}

function splitPdfTextRuns(text: string) {
  const runs: Array<{ cjk: boolean; text: string }> = []

  for (const character of [...text]) {
    const cjk = isCjkCharacter(character)
    const last = runs[runs.length - 1]
    if (last && last.cjk === cjk) {
      last.text += character
    } else {
      runs.push({ cjk, text: character })
    }
  }

  return runs
}

function isCjkCharacter(character: string) {
  const code = character.charCodeAt(0)
  return (
    (code >= 0x2e80 && code <= 0x9fff)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xff00 && code <= 0xffef)
  )
}

function measurePdfTextWidth(text: string, fontSize: number, fontWeight: number, fontFamily: string) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    return estimatePdfTextWidth(text, fontSize)
  }

  context.font = `${fontWeight} ${fontSize}px ${buildFontFamily(fontFamily)}`
  return context.measureText(text || ' ').width * 0.75
}

function estimatePdfTextWidth(text: string, fontSize: number) {
  return [...(text || ' ')].reduce((total, character) => {
    const code = character.charCodeAt(0)
    return total + fontSize * (code > 255 ? 1 : 0.56)
  }, 0)
}

function escapePdfLiteral(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function buildPdfBytes({
  pageWidthPt,
  pageHeightPt,
  content,
  imageResources,
}: {
  pageWidthPt: number
  pageHeightPt: number
  content: string
  imageResources: PdfImageResource[]
}) {
  const chunks: Uint8Array[] = []
  const offsets: number[] = [0]
  let offset = 0
  const append = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === 'string' ? asciiBytes(chunk) : chunk
    chunks.push(bytes)
    offset += bytes.length
  }
  const object = (id: number, body: string | Uint8Array, prefix = '', suffix = '') => {
    offsets[id] = offset
    append(`${id} 0 obj\n`)
    if (prefix) {
      append(prefix)
    }
    append(body)
    if (suffix) {
      append(suffix)
    }
    append('\nendobj\n')
  }

  append('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  const imageResourceText = imageResources.length > 0
    ? `/XObject << ${imageResources.map((image) => `/${image.name} ${image.objectId} 0 R`).join(' ')} >>`
    : ''
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${formatPdfNumber(pageWidthPt)} ${formatPdfNumber(pageHeightPt)}] /Resources << /Font << /F0 4 0 R /F1 7 0 R >> ${imageResourceText} >> /Contents 10 0 R >>`,
  )
  object(4, '<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [5 0 R] >>')
  object(5, '<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 2 >> /FontDescriptor 6 0 R >>')
  object(6, '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 4 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 700 /StemV 80 >>')
  object(7, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')

  for (const image of imageResources) {
    object(
      image.objectId,
      image.bytes,
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
      '\nendstream',
    )
  }

  const contentBytes = asciiBytes(content)
  object(10, contentBytes, `<< /Length ${contentBytes.length} >>\nstream\n`, 'endstream')

  const xrefOffset = offset
  const maxObjectId = Math.max(10, ...imageResources.map((image) => image.objectId))
  append(`xref\n0 ${maxObjectId + 1}\n0000000000 65535 f \n`)
  for (let id = 1; id <= maxObjectId; id += 1) {
    if (!offsets[id]) {
      append('0000000000 65535 f \n')
      continue
    }

    append(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  }
  append(`trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

  const pdfBytes = new Uint8Array(offset)
  let cursor = 0
  for (const chunk of chunks) {
    pdfBytes.set(chunk, cursor)
    cursor += chunk.length
  }
  return pdfBytes
}

function dataUrlToBase64(dataUrl: string) {
  const marker = 'base64,'
  const markerIndex = dataUrl.indexOf(marker)
  if (markerIndex < 0) {
    throw new Error('图片导出数据格式异常。')
  }

  return dataUrl.slice(markerIndex + marker.length)
}

function base64ToBytes(base64: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function asciiBytes(text: string) {
  const bytes = new Uint8Array(text.length)
  for (let index = 0; index < text.length; index += 1) {
    bytes[index] = text.charCodeAt(index) & 0xff
  }
  return bytes
}

function mmToPt(value: number) {
  return value * 72 / 25.4
}

function formatPdfNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

function renderElement(context: CanvasRenderingContext2D, element: LabelElement, pixelsPerMm: number) {
  const x = element.x * pixelsPerMm
  const y = element.y * pixelsPerMm
  const width = element.width * pixelsPerMm
  const height = element.height * pixelsPerMm

  context.save()
  context.translate(x + width / 2, y + height / 2)
  context.rotate((element.rotation * Math.PI) / 180)
  context.translate(-width / 2, -height / 2)

  const result =
    element.type === 'text'
      ? renderTextElement(context, element, width, height, pixelsPerMm)
      : element.type === 'barcode'
        ? renderBarcodeElement(context, element, width, height)
        : element.type === 'qrcode'
          ? renderQrCodeElement(context, element, width, height, pixelsPerMm)
          : element.type === 'line'
            ? renderLineElement(context, width, height, element.thickness, pixelsPerMm)
            : element.type === 'rectangle'
              ? renderRectangleElement(context, width, height, element.thickness, pixelsPerMm)
              : renderImageElement(context, element, width, height)

  return Promise.resolve(result).finally(() => context.restore())
}

function renderTextElement(
  context: CanvasRenderingContext2D,
  element: TextElement,
  width: number,
  height: number,
  pixelsPerMm: number,
) {
  const fontSizePx = Math.max(12, pointsToMm(element.fontSize) * pixelsPerMm)
  const fontWeight = element.bold ? 700 : 500
  const fontFamily = buildFontFamily(element.fontFamily)
  const text = element.text || ''
  const availableWidth = Math.max(1, width - 4)

  context.fillStyle = '#18222f'
  context.textBaseline = 'top'
  context.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`
  const measuredWidth = context.measureText(text || ' ').width
  const fitScale = clamp(availableWidth / Math.max(1, measuredWidth), 0.55, 1)
  const textX = element.align === 'right'
    ? width - measuredWidth * fitScale
    : element.align === 'center'
      ? (width - measuredWidth * fitScale) / 2
      : 0

  context.save()
  context.beginPath()
  context.rect(0, 0, width, height)
  context.clip()
  context.translate(textX, 0)
  context.scale(fitScale, 1)
  context.fillText(text, 0, 0)
  context.restore()
}

function renderBarcodeElement(context: CanvasRenderingContext2D, element: BarcodeElement, width: number, height: number) {
  const barcodeCanvas = document.createElement('canvas')
  barcodeCanvas.width = Math.max(80, Math.round(width))
  barcodeCanvas.height = Math.max(48, Math.round(height))

  try {
    const moduleCount = getBarcodeModuleCount(element)
    const valueHeight = element.showHumanReadable ? Math.max(16, barcodeCanvas.height * 0.22) : 0
    JsBarcode(barcodeCanvas, element.value || ' ', {
      format: mapBarcodeFormat(element.symbology),
      width: Math.max(1, Math.min(4, Math.floor((barcodeCanvas.width * 0.92) / moduleCount))),
      height: Math.max(18, barcodeCanvas.height - valueHeight),
      displayValue: element.showHumanReadable,
      textPosition: element.textPosition,
      margin: 0,
      background: '#ffffff',
      font: normalizeFontFamily(element.humanReadableFontFamily),
      fontSize: Math.max(8, element.humanReadableFontSize * 1.2),
      textMargin: Math.max(2, barcodeCanvas.height * 0.02),
    })
    context.drawImage(barcodeCanvas, 0, 0, width, height)
  } catch {
    drawFallbackText(context, element.value, width, height)
  }
}

async function renderQrCodeElement(
  context: CanvasRenderingContext2D,
  element: QrCodeElement,
  width: number,
  height: number,
  pixelsPerMm: number,
) {
  const textHeightMm = getQrTextAreaHeightMm(element)
  const textHeight = textHeightMm * pixelsPerMm
  const coreSize = Math.max(minElementSizeMm * pixelsPerMm, Math.min(width, height - textHeight))
  const qrCanvas = document.createElement('canvas')
  qrCanvas.width = Math.max(64, Math.round(coreSize))
  qrCanvas.height = Math.max(64, Math.round(coreSize))
  const qrY = element.showHumanReadable && element.textPosition === 'top' ? textHeight : 0

  await QRCode.toCanvas(qrCanvas, element.value || ' ', {
    margin: 0,
    width: qrCanvas.width,
  })

  if (element.showHumanReadable && element.textPosition === 'top') {
    renderHumanReadableText(context, element.value, element.humanReadableFontSize, element.humanReadableFontFamily, width, textHeight)
  }

  context.drawImage(qrCanvas, (width - coreSize) / 2, qrY, coreSize, coreSize)

  if (element.showHumanReadable && element.textPosition === 'bottom') {
    renderHumanReadableText(context, element.value, element.humanReadableFontSize, element.humanReadableFontFamily, width, textHeight, qrY + coreSize)
  }
}

function renderLineElement(context: CanvasRenderingContext2D, width: number, height: number, thickness: number, pixelsPerMm: number) {
  context.fillStyle = '#18222f'
  context.fillRect(0, 0, Math.max(1, width), Math.max(1, Math.max(height, thickness * pixelsPerMm * 0.2)))
}

function renderRectangleElement(context: CanvasRenderingContext2D, width: number, height: number, thickness: number, pixelsPerMm: number) {
  context.strokeStyle = '#18222f'
  context.lineWidth = Math.max(1, thickness * pixelsPerMm * 0.12)
  const inset = context.lineWidth / 2
  context.strokeRect(inset, inset, Math.max(1, width - context.lineWidth), Math.max(1, height - context.lineWidth))
}

async function renderImageElement(context: CanvasRenderingContext2D, element: ImageElement, width: number, height: number) {
  if (!element.dataUrl) {
    context.fillStyle = '#edf1f5'
    context.fillRect(0, 0, width, height)
    drawFallbackText(context, '图片', width, height)
    return
  }

  const image = await loadImage(element.dataUrl)
  context.drawImage(image, 0, 0, width, height)
}

function renderHumanReadableText(
  context: CanvasRenderingContext2D,
  value: string,
  fontSize: number,
  fontFamily: string,
  width: number,
  height: number,
  y = 0,
) {
  context.save()
  context.fillStyle = '#18222f'
  context.font = `500 ${Math.max(8, fontSize * 1.2)}px ${buildFontFamily(fontFamily)}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.beginPath()
  context.rect(0, y, width, height)
  context.clip()
  context.fillText(value, width / 2, y + height / 2, width)
  context.restore()
}

function drawFallbackText(context: CanvasRenderingContext2D, text: string, width: number, height: number) {
  context.save()
  context.fillStyle = '#4b5a6c'
  context.font = `500 ${Math.max(10, Math.min(width, height) * 0.2)}px ${buildFontFamily(defaultFontFamily)}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text || ' ', width / 2, height / 2, width)
  context.restore()
}

function getBarcodeModuleCount(element: BarcodeElement) {
  const data: { encodings?: Array<{ data?: string }> } = {}
  JsBarcode(data, element.value || ' ', {
    format: mapBarcodeFormat(element.symbology),
    displayValue: false,
    margin: 0,
  })

  const moduleCount = data.encodings?.reduce((total, encoding) => total + (encoding.data?.length ?? 0), 0) ?? 0
  return Math.max(40, moduleCount)
}

function mapBarcodeFormat(symbology: string) {
  const normalized = symbology.replace(/[_\s-]/g, '').toUpperCase()
  if (normalized === '128' || normalized === 'CODE128') {
    return 'CODE128'
  }

  if (normalized === 'CODE128A') {
    return 'CODE128A'
  }

  if (normalized === 'CODE128B') {
    return 'CODE128B'
  }

  if (normalized === 'CODE128C') {
    return 'CODE128C'
  }

  if (normalized === '39' || normalized === 'CODE39') {
    return 'CODE39'
  }

  if (normalized === 'EAN13') {
    return 'EAN13'
  }

  if (normalized === 'EAN8') {
    return 'EAN8'
  }

  if (normalized === 'UPCA' || normalized === 'UPCE') {
    return 'UPC'
  }

  return 'CODE128'
}

function buildFontFamily(fontFamily: string) {
  return `"${normalizeFontFamily(fontFamily)}", "Microsoft YaHei", "微软雅黑", sans-serif`
}

function getPdfPageSize(labelDocument: LabelDocument, paperMode: PdfPaperMode) {
  if (paperMode === 'a4-portrait') {
    return { widthMm: 210, heightMm: 297 }
  }

  if (paperMode === 'a4-landscape') {
    return { widthMm: 297, heightMm: 210 }
  }

  return { widthMm: labelDocument.widthMm, heightMm: labelDocument.heightMm }
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片元素加载失败。'))
    image.src = source
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
