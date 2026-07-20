import type { LabelDocument, LabelElement, PrinterEndpoint } from '../types'
import { boundsIntersect, getElementBounds, getElementOverlapRegion, type ElementOverlapSummary } from './editorGeometry'
import { getDefaultElementName, serializeDocument } from './labelDocument'

export type EditorPanelMode = 'inspector' | 'document-spec' | 'print-calibration'
export type WorkspaceSurface = 'editor' | 'templates' | 'lexicons' | 'print-check'
export type PrintCalibrationState = 'default' | 'calibrated' | 'unconfirmed' | 'unset'
export type PrintCheckStatus = 'pass' | 'warn' | 'fail'
export type PrintCheckCategory = 'device' | 'calibration' | 'document' | 'content' | 'layout' | 'output'
export type PrintCheckFilter = 'all' | 'issues'
export type PrintCheckTarget =
  | { kind: 'global' }
  | { kind: 'element'; elementId: string }
  | { kind: 'region'; left: number; top: number; width: number; height: number }
export type PrintCheckPreviewVariant = 'warning' | 'danger' | 'empty'

export type PrintCheckItem = {
  id: string
  category: PrintCheckCategory
  status: PrintCheckStatus
  title: string
  detail: string
  actionHint?: string
  target: PrintCheckTarget
  previewTargets?: PrintCheckTarget[]
  blocksPrinting: boolean
  sortOrder: number
  previewVariant?: PrintCheckPreviewVariant
}

export type PrintCheckCategorySummary = {
  key: PrintCheckCategory
  title: string
  description: string
  status: PrintCheckStatus
  items: PrintCheckItem[]
  failCount: number
  warningCount: number
  passCount: number
  issueCount: number
  blocksPrinting: boolean
}

export type PrintCheckReport = {
  signature: string
  items: PrintCheckItem[]
  categories: PrintCheckCategorySummary[]
  blockingCount: number
  warningCount: number
  passCount: number
  calibrationState: PrintCalibrationState
  calibrationLabel: string
  quickPrintAllowed: boolean
  requiresReview: boolean
  pageStatus: PrintCheckStatus
  pageTitle: string
}

const categoryMeta: Record<PrintCheckCategory, { title: string; description: string }> = {
  device: { title: '设备与连接', description: '打印机选择、在线状态与可用性。' },
  calibration: { title: '打印校准', description: '当前打印机的校准绑定与确认状态。' },
  document: { title: '文档规格', description: '标签尺寸、间隙和画布基础规格。' },
  content: { title: '内容完整性', description: '文本、条码和二维码是否具备可打印内容。' },
  layout: { title: '布局与重叠', description: '元素越界、重叠和空间冲突。' },
  output: { title: '输出准备', description: '保存状态、隐藏元素和最终输出提醒。' },
}

const categoryOrder: PrintCheckCategory[] = ['device', 'calibration', 'document', 'content', 'layout', 'output']

export function formatDocumentSpecSummary(document: LabelDocument) {
  return `${document.widthMm} x ${document.heightMm} mm · 间隙 ${document.gapMm} mm`
}

export function resolvePrintCalibrationState(document: LabelDocument, currentPrinter: PrinterEndpoint | null): PrintCalibrationState {
  if (!currentPrinter) {
    return 'unset'
  }

  if (!document.calibrationPrinterDevicePath || document.calibrationPrinterDevicePath !== currentPrinter.devicePath) {
    return 'unset'
  }

  if (document.printCalibrationState === 'default' || document.printCalibrationState === 'calibrated' || document.printCalibrationState === 'unconfirmed') {
    return document.printCalibrationState
  }

  return 'unset'
}

export function getPrintCalibrationLabel(document: LabelDocument, currentPrinter: PrinterEndpoint | null) {
  const state = resolvePrintCalibrationState(document, currentPrinter)
  return calibrationStateLabels[state]
}

export function createPrintCheckSignature(document: LabelDocument, currentPrinter: PrinterEndpoint | null) {
  return JSON.stringify({
    document: JSON.parse(serializeDocument(document)),
    printerDevicePath: currentPrinter?.devicePath ?? null,
    calibrationState: resolvePrintCalibrationState(document, currentPrinter),
  })
}

export function buildPrintCheckReport(args: {
  document: LabelDocument
  currentPrinter: PrinterEndpoint | null
  activeTabDirty: boolean
  visibleElements: LabelElement[]
  overlapSummary: ElementOverlapSummary
}) {
  const {
    document,
    currentPrinter,
    activeTabDirty,
    visibleElements,
    overlapSummary,
  } = args

  const calibrationState = resolvePrintCalibrationState(document, currentPrinter)
  const calibrationLabel = calibrationStateLabels[calibrationState]
  const items: PrintCheckItem[] = [
    ...buildDeviceItems(currentPrinter),
    ...buildCalibrationItems(calibrationState),
    ...buildDocumentItems(document),
    ...buildContentItems(visibleElements),
    ...buildLayoutItems(document, visibleElements, overlapSummary),
    ...buildOutputItems(document, activeTabDirty),
  ].sort(compareItems)

  const blockingCount = items.filter((item) => item.status === 'fail').length
  const warningCount = items.filter((item) => item.status === 'warn').length
  const passCount = items.filter((item) => item.status === 'pass').length
  const categories = categoryOrder.map((key) => createCategorySummary(key, items))
  const signature = createPrintCheckSignature(document, currentPrinter)
  const quickPrintAllowed =
    blockingCount === 0
    && calibrationState !== 'unset'
    && currentPrinter?.isAvailable === true
    && document.lastPrintCheckSignature === signature

  return {
    signature,
    items,
    categories,
    blockingCount,
    warningCount,
    passCount,
    calibrationState,
    calibrationLabel,
    quickPrintAllowed,
    requiresReview: !quickPrintAllowed,
    pageStatus: blockingCount > 0 ? 'fail' : warningCount > 0 ? 'warn' : 'pass',
    pageTitle: blockingCount > 0 ? '暂不可打印' : warningCount > 0 ? '建议处理后打印' : '可直接打印',
  } satisfies PrintCheckReport
}

function buildDeviceItems(currentPrinter: PrinterEndpoint | null): PrintCheckItem[] {
  return [
    currentPrinter
      ? {
          id: 'device-printer-selected',
          category: 'device',
          status: 'pass',
          title: '已选择打印机',
          detail: currentPrinter.displayName,
          target: { kind: 'global' },
          blocksPrinting: false,
          sortOrder: 10,
        }
      : {
          id: 'device-printer-selected',
          category: 'device',
          status: 'fail',
          title: '未选择打印机',
          detail: '当前没有目标设备，无法执行打印。',
          actionHint: '先选择在线打印机，再重新检查。',
          target: { kind: 'global' },
          blocksPrinting: true,
          sortOrder: 10,
        },
    currentPrinter?.isAvailable
      ? {
          id: 'device-printer-available',
          category: 'device',
          status: 'pass',
          title: '打印机在线可用',
          detail: currentPrinter.statusMessage,
          target: { kind: 'global' },
          blocksPrinting: false,
          sortOrder: 20,
        }
      : {
          id: 'device-printer-available',
          category: 'device',
          status: 'fail',
          title: '打印机当前不可用',
          detail: currentPrinter ? currentPrinter.statusMessage : '没有发现在线打印机。',
          actionHint: '检查打印机连接状态，或切换到其它在线设备。',
          target: { kind: 'global' },
          blocksPrinting: true,
          sortOrder: 20,
        },
  ]
}

function buildCalibrationItems(calibrationState: PrintCalibrationState): PrintCheckItem[] {
  const status: PrintCheckStatus = calibrationState === 'unset' || calibrationState === 'unconfirmed' ? 'warn' : 'pass'
  return [
    {
      id: 'calibration-state',
      category: 'calibration',
      status,
      title: calibrationState === 'unset' ? '当前打印机未绑定校准' : calibrationState === 'unconfirmed' ? '当前校准尚未确认' : '当前打印机已具备校准',
      detail:
        calibrationState === 'unset'
          ? '当前打印机还没有绑定校准，建议先检查后再打印。'
          : calibrationState === 'unconfirmed'
            ? '校准参数刚改过，建议先做一次检查或测试打印。'
            : calibrationState === 'default'
              ? '当前使用默认校准。'
              : '当前打印机已使用已保存校准。',
      actionHint: status === 'pass' ? undefined : '打开打印校准，确认偏移、方向和浓度设置。',
      target: { kind: 'global' },
      blocksPrinting: false,
      sortOrder: 100,
    },
  ]
}

function buildDocumentItems(document: LabelDocument): PrintCheckItem[] {
  const valid = Number.isFinite(document.widthMm) && Number.isFinite(document.heightMm) && document.widthMm > 0 && document.heightMm > 0
  return [
    {
      id: 'document-spec',
      category: 'document',
      status: valid ? 'pass' : 'fail',
      title: valid ? '文档规格有效' : '文档规格无效',
      detail: valid ? formatDocumentSpecSummary(document) : '标签宽高必须大于 0，才能生成有效打印结果。',
      actionHint: valid ? undefined : '打开文档规格，修正标签宽度和高度。',
      target: { kind: 'global' },
      blocksPrinting: !valid,
      sortOrder: 200,
    },
  ]
}

function buildContentItems(visibleElements: LabelElement[]): PrintCheckItem[] {
  const items: PrintCheckItem[] = []
  const emptyTextElements = visibleElements.filter((element) => element.type === 'text' && element.text.trim().length === 0)
  const emptyCodeElements = visibleElements.filter((element) => (element.type === 'barcode' || element.type === 'qrcode') && element.value.trim().length === 0)

  if (emptyTextElements.length === 0) {
    items.push({
      id: 'content-text-complete',
      category: 'content',
      status: 'pass',
      title: '文本内容完整',
      detail: '没有发现空文本元素。',
      target: { kind: 'global' },
      blocksPrinting: false,
      sortOrder: 300,
    })
  } else {
    items.push(
      ...emptyTextElements.map((element, index) => ({
        id: `content-empty-text-${element.id}`,
        category: 'content',
        status: 'warn',
        title: `${getElementDisplayName(element)} 为空`,
        detail: '空文本会直接打印为空白，容易让标签信息缺失。',
        actionHint: '返回编辑器，为该文本填写内容或删除它。',
        target: { kind: 'element', elementId: element.id },
        blocksPrinting: false,
        sortOrder: 310 + index,
        previewVariant: 'empty',
      } satisfies PrintCheckItem)),
    )
  }

  if (emptyCodeElements.length === 0) {
    items.push({
      id: 'content-code-complete',
      category: 'content',
      status: 'pass',
      title: '条码与二维码内容完整',
      detail: '所有条码和二维码都具备可输出内容。',
      target: { kind: 'global' },
      blocksPrinting: false,
      sortOrder: 320,
    })
  } else {
    items.push(
      ...emptyCodeElements.map((element, index) => ({
        id: `content-empty-code-${element.id}`,
        category: 'content',
        status: 'fail',
        title: `${getElementDisplayName(element)} 内容为空`,
        detail: '空条码或空二维码会导致打印结果不可扫描。',
        actionHint: '返回编辑器，为该编码元素填写内容后重新检查。',
        target: { kind: 'element', elementId: element.id },
        blocksPrinting: true,
        sortOrder: 330 + index,
        previewVariant: 'danger',
      } satisfies PrintCheckItem)),
    )
  }

  return items
}

function buildLayoutItems(document: LabelDocument, visibleElements: LabelElement[], overlapSummary: ElementOverlapSummary): PrintCheckItem[] {
  const items: PrintCheckItem[] = []
  const outOfBoundsItems = visibleElements
    .filter((element) => isOutOfBounds(element, document))
    .map((element, index) => {
      const bounds = getElementBounds(element)
      return {
        id: `layout-out-of-bounds-${element.id}`,
        category: 'layout',
        status: 'fail',
        title: `${getElementDisplayName(element)} 超出画布`,
        detail: '元素超出标签边界后，打印内容会被裁切或直接丢失。',
        actionHint: '返回编辑器，把该元素移动回标签可打印区域。',
        target: { kind: 'region', left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height },
        blocksPrinting: true,
        sortOrder: 400 + index,
        previewVariant: 'danger',
      } satisfies PrintCheckItem
    })

  if (outOfBoundsItems.length === 0) {
    items.push({
      id: 'layout-bounds-safe',
      category: 'layout',
      status: 'pass',
      title: '元素都在画布内',
      detail: '所有可见元素都位于标签画布范围内。',
      target: { kind: 'global' },
      blocksPrinting: false,
      sortOrder: 400,
    })
  } else {
    items.push(...outOfBoundsItems)
  }

  const overlapItems = buildOverlapItems(visibleElements)
  if (overlapItems.length === 0) {
    items.push({
      id: 'layout-no-overlap',
      category: 'layout',
      status: 'pass',
      title: '没有发现元素重叠',
      detail: overlapSummary.overlapCount > 0 ? `已检测 ${overlapSummary.overlapCount} 组重叠风险。` : '当前可见元素之间没有重叠冲突。',
      target: { kind: 'global' },
      blocksPrinting: false,
      sortOrder: 500,
    })
  } else {
    items.push(...overlapItems)
  }

  return items
}

function buildOutputItems(document: LabelDocument, activeTabDirty: boolean): PrintCheckItem[] {
  const items: PrintCheckItem[] = []
  const hiddenCount = document.elements.filter((element) => element.hidden).length

  items.push({
    id: 'output-hidden-elements',
    category: 'output',
    status: hiddenCount > 0 ? 'warn' : 'pass',
    title: hiddenCount > 0 ? `有 ${hiddenCount} 个隐藏元素不会参与打印` : '没有隐藏元素',
    detail: hiddenCount > 0 ? '隐藏元素会保留在模板中，但不会出现在实际打印结果里。' : '所有元素都会参与输出。',
    actionHint: hiddenCount > 0 ? '如果这些元素需要参与打印，返回编辑器并取消隐藏。' : undefined,
    target: { kind: 'global' },
    blocksPrinting: false,
    sortOrder: 600,
  })

  items.push({
    id: 'output-unsaved',
    category: 'output',
    status: activeTabDirty ? 'warn' : 'pass',
    title: activeTabDirty ? '当前文档还有未保存修改' : '当前文档已保存',
    detail: activeTabDirty ? '未保存不会阻止打印，但会增加重复检查和回退的成本。' : '当前模板与本地保存版本一致。',
    actionHint: activeTabDirty ? '先保存当前模板，再执行正式打印。' : undefined,
    target: { kind: 'global' },
    blocksPrinting: false,
    sortOrder: 610,
  })

  return items
}

function buildOverlapItems(visibleElements: LabelElement[]) {
  const items: PrintCheckItem[] = []

  for (let leftIndex = 0; leftIndex < visibleElements.length - 1; leftIndex += 1) {
    const left = visibleElements[leftIndex]
    for (let rightIndex = leftIndex + 1; rightIndex < visibleElements.length; rightIndex += 1) {
      const right = visibleElements[rightIndex]
      const overlap = getElementOverlapRegion(left, right)
      if (!overlap) {
        continue
      }

      const includesCode = left.type === 'barcode' || left.type === 'qrcode' || right.type === 'barcode' || right.type === 'qrcode'
      items.push({
        id: `layout-overlap-${left.id}-${right.id}`,
        category: 'layout',
        status: 'warn',
        title: `${getElementDisplayName(left)} 与 ${getElementDisplayName(right)} 发生重叠`,
        detail: includesCode ? '重叠区域涉及条码或二维码，可能导致打印过黑或扫码失败。' : '重叠区域可能会重复打印，导致内容变粗、变黑或难以辨认。',
        actionHint: '返回编辑器，调整元素间距或层级，避免互相覆盖。',
        target: {
          kind: 'region',
          left: overlap.left,
          top: overlap.top,
          width: overlap.width,
          height: overlap.height,
        },
        previewTargets: [
          { kind: 'element', elementId: left.id },
          { kind: 'element', elementId: right.id },
        ],
        blocksPrinting: false,
        sortOrder: includesCode ? 500 : 520,
        previewVariant: includesCode ? 'danger' : 'warning',
      })
    }
  }

  return items
}

function createCategorySummary(key: PrintCheckCategory, items: PrintCheckItem[]): PrintCheckCategorySummary {
  const categoryItems = items.filter((item) => item.category === key).sort(compareItems)
  const failCount = categoryItems.filter((item) => item.status === 'fail').length
  const warningCount = categoryItems.filter((item) => item.status === 'warn').length
  const passCount = categoryItems.filter((item) => item.status === 'pass').length

  return {
    key,
    title: categoryMeta[key].title,
    description: categoryMeta[key].description,
    status: failCount > 0 ? 'fail' : warningCount > 0 ? 'warn' : 'pass',
    items: categoryItems,
    failCount,
    warningCount,
    passCount,
    issueCount: failCount + warningCount,
    blocksPrinting: categoryItems.some((item) => item.blocksPrinting),
  }
}

function compareItems(left: PrintCheckItem, right: PrintCheckItem) {
  return byStatusWeight(left.status) - byStatusWeight(right.status) || left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, 'zh-CN')
}

function byStatusWeight(status: PrintCheckStatus) {
  return status === 'fail' ? 0 : status === 'warn' ? 1 : 2
}

function getElementDisplayName(element: LabelElement) {
  return element.name?.trim() || getDefaultElementName(element.type)
}

function isOutOfBounds(element: LabelElement, document: LabelDocument) {
  const bounds = getElementBounds(element)
  const canvasBounds = {
    left: 0,
    top: 0,
    right: document.widthMm,
    bottom: document.heightMm,
    width: document.widthMm,
    height: document.heightMm,
    centerX: document.widthMm / 2,
    centerY: document.heightMm / 2,
  }

  if (!boundsIntersect(bounds, canvasBounds)) {
    return true
  }

  return bounds.left < 0 || bounds.top < 0 || bounds.right > document.widthMm || bounds.bottom > document.heightMm
}

const calibrationStateLabels: Record<PrintCalibrationState, string> = {
  default: '默认',
  calibrated: '已校准',
  unconfirmed: '未确认',
  unset: '未设置',
}
