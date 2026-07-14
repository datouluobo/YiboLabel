import JsBarcode from 'jsbarcode'
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  ChevronsDown,
  ChevronsUp,
  Eye,
  EyeOff,
  FilePlus2,
  ImagePlus,
  Layers,
  LockKeyhole,
  Minus,
  RotateCcw,
  Printer,
  RefreshCw,
  Upload,
  QrCode,
  Save,
  ScanBarcode,
  Square,
  Type,
  UnlockKeyhole,
} from 'lucide-react'
import QRCode from 'qrcode'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import clsx from 'clsx'
import './App.css'
import type {
  AppStateResponse,
  BarcodeElement,
  DuplicateTemplateRequest,
  ImageElement,
  LabelDocument,
  LabelElement,
  LabelTemplateRecord,
  LabelTemplateSummary,
  LexiconEntry,
  LexiconGroup,
  LexiconLibrary,
  LexiconGroupSummary,
  LexiconSuggestion,
  LineElement,
  PrintResult,
  QrCodeElement,
  RectangleElement,
  TextElement,
  UpdateTemplateMetaRequest,
} from './types'

const baseCanvasScale = 16
const historyLimit = 40
const minDocumentSizeMm = 20
const minElementSizeMm = 0.8
const snapDistanceMm = 0.8

type Point = {
  x: number
  y: number
}

type Bounds = {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
  centerX: number
  centerY: number
}

type RulerTick = {
  value: number
  major: boolean
}

type SnapLine = {
  orientation: 'vertical' | 'horizontal'
  value: number
}

type DlabelPaperLayout = {
  widthMm: number
  heightMm: number
  rotation: number
  sourceWidthMm: number
  sourceHeightMm: number
}

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type HistoryState = {
  past: LabelDocument[]
  future: LabelDocument[]
}

type EditorTab = {
  id: string
  templateId: string | null
  document: LabelDocument
  templateDescription: string
  templateTags: string[]
  templateSource: string
  selectedElementIds: string[]
  history: HistoryState
  lastSavedSnapshot: string
}

type TemplateSort = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'created-desc' | 'created-asc'

type ClosedTabSnapshot = {
  templateId: string | null
  document: LabelDocument
  templateDescription: string
  templateTags: string[]
  templateSource: string
  selectedElementIds: string[]
  lastSavedSnapshot: string
}

type WorkspaceSurface = 'editor' | 'templates' | 'lexicons'
type WindowChromeCommand = 'drag' | 'toggle-maximize' | 'minimize' | 'close'
type LayerAction = 'front' | 'back' | 'forward' | 'backward'

type WorkspaceSnapshot = {
  version: 6
  activeTabId: string | null
  tabs: Array<{
    id: string
    templateId: string | null
    document: LabelDocument
    templateDescription: string
    templateTags: string[]
    templateSource: string
    selectedElementIds: string[]
    history: HistoryState
    lastSavedSnapshot: string
  }>
}

type MoveInteraction = {
  mode: 'move'
  pointerId: number
  start: Point
  startDocument: LabelDocument
  selectedIds: string[]
}

type ResizeInteraction = {
  mode: 'resize'
  pointerId: number
  start: Point
  startDocument: LabelDocument
  elementId: string
  handle: ResizeHandle
}

type RotateInteraction = {
  mode: 'rotate'
  pointerId: number
  start: Point
  startDocument: LabelDocument
  elementId: string
}

type MarqueeInteraction = {
  mode: 'marquee'
  pointerId: number
  start: Point
  current: Point
  additive: boolean
  initialSelectionIds: string[]
}

type EditorInteraction = MoveInteraction | ResizeInteraction | RotateInteraction | MarqueeInteraction

const workspaceStorageKey = 'yibolabel.workspace.v6'
const recentClosedTabLimit = 8

const createId = () => crypto.randomUUID()

const getDefaultElementName = (type: LabelElement['type']) =>
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

const createBlankDocument = (name = '未命名标签'): LabelDocument =>
  normalizeDocument({
    name,
    widthMm: 40,
    heightMm: 30,
    copies: 1,
    darkness: 8,
    gapMm: 2,
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
        bold: true,
        align: 'left',
      },
    ],
  })

function createEditorTab(
  document: LabelDocument,
  options?: {
    id?: string
    templateId?: string | null
    selectedElementIds?: string[]
    templateDescription?: string
    templateTags?: string[]
    templateSource?: string
  },
): EditorTab {
  const normalized = normalizeDocument(document)
  return {
    id: options?.id ?? createId(),
    templateId: options?.templateId ?? null,
    document: normalized,
    templateDescription: options?.templateDescription ?? '',
    templateTags: options?.templateTags ?? [],
    templateSource: options?.templateSource ?? (options?.templateId ? 'manual' : 'blank'),
    selectedElementIds: options?.selectedElementIds ?? [normalized.elements[0]?.id].filter(Boolean) as string[],
    history: { past: [], future: [] },
    lastSavedSnapshot: serializeTabSnapshot({
      document: normalized,
      templateDescription: options?.templateDescription ?? '',
      templateTags: options?.templateTags ?? [],
      templateSource: options?.templateSource ?? (options?.templateId ? 'manual' : 'blank'),
    }),
  }
}

function normalizeHistory(history: HistoryState | undefined) {
  return {
    past: (history?.past ?? []).map((document) => normalizeDocument(document)).slice(-historyLimit),
    future: (history?.future ?? []).map((document) => normalizeDocument(document)).slice(0, historyLimit),
  }
}

function normalizeEditorTab(tab: WorkspaceSnapshot['tabs'][number]): EditorTab {
  const normalizedDocument = normalizeDocument(tab.document)
  const validSelection = (tab.selectedElementIds ?? []).filter((id) => normalizedDocument.elements.some((element) => element.id === id))
  return {
    id: tab.id || createId(),
    templateId: tab.templateId ?? null,
    document: normalizedDocument,
    templateDescription: tab.templateDescription ?? '',
    templateTags: tab.templateTags ?? [],
    templateSource: tab.templateSource ?? (tab.templateId ? 'manual' : 'blank'),
    selectedElementIds: validSelection,
    history: normalizeHistory(tab.history),
    lastSavedSnapshot: tab.lastSavedSnapshot || serializeTabSnapshot({
      document: normalizedDocument,
      templateDescription: tab.templateDescription ?? '',
      templateTags: tab.templateTags ?? [],
      templateSource: tab.templateSource ?? (tab.templateId ? 'manual' : 'blank'),
    }),
  }
}

function readWorkspaceSnapshot(): WorkspaceSnapshot | null {
  try {
    const raw = window.localStorage.getItem(workspaceStorageKey)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as WorkspaceSnapshot
    if (parsed?.version !== 6 || !Array.isArray(parsed.tabs)) {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function getTabDisplayName(tab: Pick<EditorTab, 'document'>) {
  return tab.document.name?.trim() || '未命名标签'
}

function isTabDirty(tab: Pick<EditorTab, 'document' | 'templateDescription' | 'templateTags' | 'templateSource' | 'lastSavedSnapshot'>) {
  return serializeTabSnapshot(tab) !== tab.lastSavedSnapshot
}

function createElement(type: LabelElement['type'], document: LabelDocument, seed?: Partial<LabelElement>): LabelElement {
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
      ? { ...base, type, text: '新文本', fontSize: 22, bold: false, align: 'left' as const }
      : type === 'barcode'
        ? { ...base, type, width: 28, height: 10, value: '1234567890', symbology: '128', showHumanReadable: true, textPosition: 'bottom' as const, humanReadableFontSize: 12 }
        : type === 'qrcode'
          ? { ...base, type, width: 10, height: 10, value: 'https://yibo.local', showHumanReadable: false, textPosition: 'bottom' as const, humanReadableFontSize: 12 }
          : type === 'line'
            ? { ...base, type, width: 20, height: 0.8, thickness: 2 }
            : type === 'rectangle'
              ? { ...base, type, width: 18, height: 12, thickness: 1 }
              : { ...base, type, width: 16, height: 12, dataUrl: '', invert: false }

  return normalizeElement({ ...next, ...seed } as LabelElement, document, document.elements.length)
}

function normalizeDocument(document: LabelDocument): LabelDocument {
  const widthMm = clamp(roundTo(document.widthMm || 40, 0.1), minDocumentSizeMm, 200)
  const heightMm = clamp(roundTo(document.heightMm || 30, 0.1), minDocumentSizeMm, 200)
  const base: LabelDocument = {
    ...document,
    name: document.name || '未命名标签',
    widthMm,
    heightMm,
    copies: clamp(Math.round(document.copies || 1), 1, 99),
    darkness: clamp(roundTo(document.darkness || 8, 0.1), 1, 15),
    gapMm: clamp(roundTo(document.gapMm || 2, 0.1), 0, 20),
    elements: [],
  }

  base.elements = (document.elements ?? []).map((element, index) => normalizeElement(element, base, index))
  return { ...base, elements: reindexElements(base.elements) }
}

function normalizeElement(element: LabelElement, document: LabelDocument, index: number): LabelElement {
  const widthLimit = Math.max(minElementSizeMm, document.widthMm)
  const heightLimit = Math.max(minElementSizeMm, document.heightMm)
  const width = clamp(roundTo(element.width || minElementSizeMm, 0.1), minElementSizeMm, widthLimit)
  const unclampedHeight = clamp(roundTo(element.height || minElementSizeMm, 0.1), minElementSizeMm, heightLimit)
  const x = clamp(roundTo(element.x || 0, 0.1), 0, Math.max(0, document.widthMm - width))
  const defaultHeight = element.type === 'line' ? 0.8 : unclampedHeight
  const height = clamp(roundTo(defaultHeight, 0.1), minElementSizeMm, heightLimit)
  const y = clamp(roundTo(element.y || 0, 0.1), 0, Math.max(0, document.heightMm - height))
  const common = {
    ...element,
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

  if (element.type === 'text') {
    return {
      ...common,
      text: element.text ?? '',
      fontSize: clamp(Math.round(element.fontSize || 22), 8, 96),
      bold: Boolean(element.bold),
      align: element.align === 'center' || element.align === 'right' ? element.align : 'left',
    } as TextElement
  }

  if (element.type === 'barcode') {
    return {
      ...common,
      value: element.value ?? '',
      symbology: element.symbology?.trim() || '128',
      showHumanReadable: Boolean(element.showHumanReadable),
      textPosition: element.textPosition === 'top' ? 'top' : 'bottom',
      humanReadableFontSize: clamp(Math.round(element.humanReadableFontSize || 12), 8, 36),
    } as BarcodeElement
  }

  if (element.type === 'qrcode') {
    const humanReadableFontSize = clamp(Math.round(element.humanReadableFontSize || 12), 8, 36)
    const showHumanReadable = Boolean(element.showHumanReadable)
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
      value: element.value ?? '',
      showHumanReadable,
      textPosition: element.textPosition === 'top' ? 'top' : 'bottom',
      humanReadableFontSize,
    } as QrCodeElement
  }

  if (element.type === 'line') {
    const thickness = clamp(Math.round(element.thickness || 1), 1, 8)
    return {
      ...common,
      height: clamp(common.height, minElementSizeMm, document.heightMm),
      thickness,
    } as LineElement
  }

  if (element.type === 'rectangle') {
    return {
      ...common,
      thickness: clamp(Math.round(element.thickness || 1), 1, 8),
    } as RectangleElement
  }

  return {
    ...common,
    dataUrl: element.dataUrl ?? '',
    invert: Boolean(element.invert),
  } as ImageElement
}

function reindexElements(elements: LabelElement[]) {
  return [...elements]
    .sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0) || left.id.localeCompare(right.id))
    .map((element, index) => ({ ...element, zIndex: index }))
}

function toTemplateSummary(record: LabelTemplateRecord): LabelTemplateSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    tags: record.tags,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt,
    widthMm: record.document.widthMm,
    heightMm: record.document.heightMm,
    elementCount: record.document.elements.length,
  }
}

function sortElements(elements: LabelElement[]) {
  return [...elements].sort((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0) || left.id.localeCompare(right.id))
}

function serializeDocument(document: LabelDocument) {
  return JSON.stringify(normalizeDocument(document))
}

function serializeTabSnapshot(tab: Pick<EditorTab, 'document' | 'templateDescription' | 'templateTags' | 'templateSource'>) {
  return JSON.stringify({
    document: normalizeDocument(tab.document),
    templateDescription: tab.templateDescription.trim(),
    templateTags: [...tab.templateTags].map((tag) => tag.trim()).filter(Boolean).sort((left, right) => left.localeCompare(right, 'zh-CN')),
    templateSource: tab.templateSource,
  })
}

function parseSerializedDocument(serialized: string) {
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

function normalizeRotation(rotation: number) {
  const normalized = ((rotation % 360) + 360) % 360
  return roundTo(normalized, 1)
}

function roundTo(value: number, step: number) {
  return Math.round(value / step) * step
}

function pointsToMm(points: number) {
  return points * 0.352778
}

function getQrTextHeightMm(fontSize: number) {
  return roundTo(pointsToMm(fontSize) * 1.28, 0.1)
}

function getQrTextAreaHeightMm(element: Pick<QrCodeElement, 'showHumanReadable' | 'humanReadableFontSize'>) {
  return element.showHumanReadable ? getQrTextHeightMm(element.humanReadableFontSize) : 0
}

function clamp(value: number, min: number, max: number) {
  if (max < min) {
    return min
  }

  return Math.min(Math.max(value, min), max)
}

function getElementBounds(element: LabelElement): Bounds {
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

function getSelectionBounds(elements: LabelElement[]): Bounds | null {
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

function boundsIntersect(left: Bounds, right: Bounds) {
  return left.left <= right.right && left.right >= right.left && left.top <= right.bottom && left.bottom >= right.top
}

function pointFromPointer(bounds: DOMRect, event: PointerEvent | ReactPointerEvent, scale: number): Point {
  return {
    x: clamp((event.clientX - bounds.left) / scale, 0, bounds.width / scale),
    y: clamp((event.clientY - bounds.top) / scale, 0, bounds.height / scale),
  }
}

function isTextInputTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return target.closest('input, textarea, select, [contenteditable="true"]') !== null
}

function getLayerMeta(element: LabelElement) {
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

function getLayerPositionLabel(element: LabelElement, layerCount: number) {
  return `第 ${(element.zIndex ?? 0) + 1} 层 / 共 ${layerCount} 层`
}

function parseTagInput(value: string) {
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function formatTemplateSource(source: string) {
  if (source === 'ddl-import') {
    return 'DDL 导入'
  }
  if (source === 'duplicate') {
    return '模板复制'
  }
  if (source === 'seed') {
    return '系统示例'
  }
  if (source === 'blank') {
    return '空白草稿'
  }
  return '手工创建'
}

function isLexiconEnabledElement(element: LabelElement | null): element is TextElement | BarcodeElement | QrCodeElement {
  return element?.type === 'text' || element?.type === 'barcode' || element?.type === 'qrcode'
}

function createContentPatch(element: TextElement | BarcodeElement | QrCodeElement, value: string): Partial<LabelElement> {
  return element.type === 'text' ? ({ text: value } as Partial<TextElement>) : ({ value } as Partial<BarcodeElement | QrCodeElement>)
}

function getMarqueeBounds(start: Point, current: Point): Bounds {
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

function createRulerTicks(lengthMm: number): RulerTick[] {
  const ticks: RulerTick[] = []
  for (let value = 0; value <= lengthMm + 0.01; value += 5) {
    const rounded = roundTo(value, 0.1)
    ticks.push({ value: rounded, major: Math.round(rounded) % 10 === 0 })
  }
  return ticks
}

function getElementsAtPoint(document: LabelDocument, point: Point) {
  return sortElements(document.elements)
    .filter((element) => !element.hidden)
    .filter((element) => {
      const bounds = getElementBounds(element)
      return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom
    })
}

function getSnapTargets(document: LabelDocument, excludedIds: string[]) {
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

function findBestSnap(value: number, targets: number[]) {
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

function snapMoveBounds(bounds: Bounds, document: LabelDocument, selectedIds: string[]) {
  const targets = getSnapTargets(document, selectedIds)
  const xCandidates = [
    { value: bounds.left, orientation: 'vertical' as const },
    { value: bounds.centerX, orientation: 'vertical' as const },
    { value: bounds.right, orientation: 'vertical' as const },
  ]
  const yCandidates = [
    { value: bounds.top, orientation: 'horizontal' as const },
    { value: bounds.centerY, orientation: 'horizontal' as const },
    { value: bounds.bottom, orientation: 'horizontal' as const },
  ]

  let deltaX = 0
  let deltaY = 0
  let verticalLine: number | null = null
  let horizontalLine: number | null = null

  for (const candidate of xCandidates) {
    const snap = findBestSnap(candidate.value + deltaX, targets.vertical)
    if (snap.target !== null && (verticalLine === null || Math.abs(snap.delta) < Math.abs(deltaX))) {
      deltaX = snap.delta
      verticalLine = snap.target
    }
  }

  for (const candidate of yCandidates) {
    const snap = findBestSnap(candidate.value + deltaY, targets.horizontal)
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

function reorderElements(elements: LabelElement[], selectedIds: string[], action: LayerAction) {
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

function sendWindowChromeCommand(command: WindowChromeCommand) {
  const chromeBridge = (window as typeof window & { chrome?: { webview?: { postMessage: (message: unknown) => void } } }).chrome?.webview
  chromeBridge?.postMessage({ type: 'window-chrome', command })
}

export default function App() {
  const [appState, setAppState] = useState<AppStateResponse | null>(null)
  const [templates, setTemplates] = useState<LabelTemplateSummary[]>([])
  const [templateQuery, setTemplateQuery] = useState('')
  const [templateSort, setTemplateSort] = useState<TemplateSort>('updated-desc')
  const [lexiconGroups, setLexiconGroups] = useState<LexiconGroupSummary[]>([])
  const [lexiconLibrary, setLexiconLibrary] = useState<LexiconLibrary>({ schemaVersion: 1, lexicons: [] })
  const [activeLexiconId, setActiveLexiconId] = useState<string | null>(null)
  const [activeLexiconGroupId, setActiveLexiconGroupId] = useState<string | null>(null)
  const [lexiconQuery, setLexiconQuery] = useState('')
  const [contentPickerOpen, setContentPickerOpen] = useState(false)
  const [contentPickerPosition, setContentPickerPosition] = useState<Point>({ x: 560, y: 160 })
  const [groupBinderOpen, setGroupBinderOpen] = useState(false)
  const [groupBinderPosition, setGroupBinderPosition] = useState<Point>({ x: 520, y: 150 })
  const [groupBinderQuery, setGroupBinderQuery] = useState('')
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [activeSurface, setActiveSurface] = useState<WorkspaceSurface>('editor')
  const [lastEditorTabId, setLastEditorTabId] = useState<string | null>(null)
  const [recentClosedTabs, setRecentClosedTabs] = useState<ClosedTabSnapshot[]>([])
  const [, setStatus] = useState('正在加载本地标签工作台...')
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [refreshingPrinters, setRefreshingPrinters] = useState(false)
  const [showDocumentDialog, setShowDocumentDialog] = useState(false)
  const [layersCollapsed, setLayersCollapsed] = useState(false)
  const [, setActivity] = useState<string[]>([])
  const [interaction, setInteraction] = useState<EditorInteraction | null>(null)
  const [snapLines, setSnapLines] = useState<SnapLine[]>([])
  const [canvasViewportScale, setCanvasViewportScale] = useState(1)
  const [canvasUserZoom, setCanvasUserZoom] = useState(1)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const ddlInputRef = useRef<HTMLInputElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)
  const tabsRef = useRef<EditorTab[]>([])
  const fallbackDocument = useMemo(() => createBlankDocument(), [])
  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [activeTabId, tabs])
  const hasActiveTab = activeTab !== null
  const labelDocument = activeTab?.document ?? fallbackDocument
  const selectedElementIds = activeTab?.selectedElementIds ?? []
  const history = activeTab?.history ?? { past: [], future: [] }
  const activeTemplateId = activeTab?.templateId ?? null
  const templateDescription = activeTab?.templateDescription ?? ''
  const templateTags = activeTab?.templateTags ?? []
  const templateSource = activeTab?.templateSource ?? 'blank'
  const documentRef = useRef(labelDocument)
  const historyRef = useRef(history)

  useEffect(() => {
    documentRef.current = labelDocument
  }, [labelDocument])

  useEffect(() => {
    historyRef.current = history
  }, [history])

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])

  useEffect(() => {
    const hasDirtyTabs = tabs.some((tab) => isTabDirty(tab))
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyTabs) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [tabs])

  useEffect(() => {
    if (tabs.length === 0) {
      window.localStorage.removeItem(workspaceStorageKey)
      return
    }

    const snapshot: WorkspaceSnapshot = {
      version: 6,
      activeTabId,
      tabs: tabs.map((tab) => ({
        id: tab.id,
        templateId: tab.templateId,
        document: tab.document,
        templateDescription: tab.templateDescription,
        templateTags: tab.templateTags,
        templateSource: tab.templateSource,
        selectedElementIds: tab.selectedElementIds,
        history: tab.history,
        lastSavedSnapshot: tab.lastSavedSnapshot,
      })),
    }

    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(snapshot))
  }, [activeTabId, tabs])

  const sortedElements = useMemo(() => (hasActiveTab ? sortElements(labelDocument.elements) : []), [hasActiveTab, labelDocument.elements])
  const visibleElements = useMemo(() => sortedElements.filter((element) => !element.hidden), [sortedElements])
  const selectedElements = useMemo(
    () => sortElements(labelDocument.elements.filter((element) => selectedElementIds.includes(element.id))),
    [labelDocument.elements, selectedElementIds],
  )
  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : null
  const bindableSelectedElements = useMemo(
    () => selectedElements.filter(isLexiconEnabledElement),
    [selectedElements],
  )
  const currentPrinter = useMemo(() => {
    const devicePath = labelDocument.printerDevicePath ?? appState?.printers[0]?.devicePath
    return appState?.printers.find((printer) => printer.devicePath === devicePath) ?? null
  }, [appState?.printers, labelDocument.printerDevicePath])
  const openedTemplateState = useMemo(() => {
    const state = new Map<string, { openCount: number; current: boolean; dirty: boolean }>()
    for (const tab of tabs) {
      if (!tab.templateId) {
        continue
      }

      const existing = state.get(tab.templateId) ?? { openCount: 0, current: false, dirty: false }
      existing.openCount += 1
      existing.current ||= tab.id === activeTabId
      existing.dirty ||= isTabDirty(tab)
      state.set(tab.templateId, existing)
    }

    return state
  }, [activeTabId, tabs])
  const visibleTemplates = useMemo(() => {
    const query = templateQuery.trim().toLowerCase()
    const filtered = query.length === 0
      ? templates
      : templates.filter((template) =>
          template.name.toLowerCase().includes(query)
          || template.description.toLowerCase().includes(query)
          || template.tags.some((tag) => tag.toLowerCase().includes(query)),
        )

    const sorted = [...filtered]
    sorted.sort((left, right) => {
      if (templateSort === 'name-asc') {
        return left.name.localeCompare(right.name, 'zh-CN')
      }
      if (templateSort === 'name-desc') {
        return right.name.localeCompare(left.name, 'zh-CN')
      }
      if (templateSort === 'created-asc') {
        return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
      }
      if (templateSort === 'created-desc') {
        return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      }
      if (templateSort === 'updated-asc') {
        return new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime()
      }

      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
    })
    return sorted
  }, [templateQuery, templateSort, templates])
  const activeLexicon = useMemo(
    () => lexiconLibrary.lexicons.find((lexicon) => lexicon.id === activeLexiconId) ?? lexiconLibrary.lexicons[0] ?? null,
    [activeLexiconId, lexiconLibrary.lexicons],
  )
  const activeLexiconGroup = useMemo(
    () => activeLexicon?.groups.find((group) => group.id === activeLexiconGroupId) ?? activeLexicon?.groups[0] ?? null,
    [activeLexicon, activeLexiconGroupId],
  )
  const filteredLexiconEntries = useMemo(() => {
    const entries = activeLexiconGroup?.entries ?? []
    const query = lexiconQuery.trim().toLowerCase()
    if (!query) {
      return entries
    }

    return entries.filter((entry) => entry.text.toLowerCase().includes(query))
  }, [activeLexiconGroup?.entries, lexiconQuery])
  const selectedVisibleElements = selectedElements.filter((element) => !element.hidden)
  const selectionBounds = useMemo(() => getSelectionBounds(selectedVisibleElements), [selectedVisibleElements])
  const marqueeBounds = interaction?.mode === 'marquee' ? getMarqueeBounds(interaction.start, interaction.current) : null
  const resolvedVisibleElements = visibleElements
  const horizontalRulerTicks = useMemo(() => createRulerTicks(labelDocument.widthMm), [labelDocument.widthMm])
  const verticalRulerTicks = useMemo(() => createRulerTicks(labelDocument.heightMm), [labelDocument.heightMm])
  const boundLexiconGroups = useMemo(() => {
    if (!isLexiconEnabledElement(selectedElement)) {
      return []
    }

    const groupIds = new Set(selectedElement.lexiconGroupIds ?? [])
    return lexiconGroups.filter((group) => groupIds.has(group.id))
  }, [lexiconGroups, selectedElement])
  const currentSnapshot = useMemo(
    () => (activeTab ? serializeTabSnapshot(activeTab) : ''),
    [activeTab],
  )
  const canvasScale = baseCanvasScale * canvasViewportScale * canvasUserZoom

  useEffect(() => {
    void bootstrap()
  }, [])

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault()
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', handleWheel, { capture: true })
  }, [])

  function updateActiveTab(mutator: (tab: EditorTab) => EditorTab) {
    if (!activeTabId) {
      return
    }

    setTabs((currentTabs) => currentTabs.map((tab) => (tab.id === activeTabId ? mutator(tab) : tab)))
  }

  function setActiveDocument(nextDocument: LabelDocument, options?: { pushHistory?: boolean }) {
    updateActiveTab((tab) => {
      const normalized = normalizeDocument(nextDocument)
      if (serializeDocument(tab.document) === serializeDocument(normalized)) {
        return tab
      }

      const nextHistory =
        options?.pushHistory === false
          ? tab.history
          : {
              past: [...tab.history.past, tab.document].slice(-historyLimit),
              future: [],
            }

      return {
        ...tab,
        document: normalized,
        history: nextHistory,
        selectedElementIds: tab.selectedElementIds.filter((id) => normalized.elements.some((element) => element.id === id)),
      }
    })
  }

  function setActiveSelection(nextSelection: string[]) {
    updateActiveTab((tab) => ({
      ...tab,
      selectedElementIds: nextSelection.filter((id) => tab.document.elements.some((element) => element.id === id)),
    }))
  }

  function showEditor(tabId?: string | null) {
    const targetId = tabId ?? lastEditorTabId ?? activeTabId ?? tabsRef.current[0]?.id ?? null
    if (targetId) {
      setActiveTabId(targetId)
      setLastEditorTabId(targetId)
    }
    setActiveSurface('editor')
  }

  function toggleSurface(surface: Exclude<WorkspaceSurface, 'editor'>) {
    if (activeSurface === surface) {
      showEditor()
      return
    }

    if (activeSurface === 'editor' && activeTabId) {
      setLastEditorTabId(activeTabId)
    }
    setActiveSurface(surface)
  }

  function setActiveTemplateMeta(patch: Partial<Pick<EditorTab, 'templateDescription' | 'templateTags' | 'templateSource'>>) {
    updateActiveTab((tab) => ({
      ...tab,
      templateDescription: patch.templateDescription ?? tab.templateDescription,
      templateTags: patch.templateTags ?? tab.templateTags,
      templateSource: patch.templateSource ?? tab.templateSource,
    }))
  }

  function toggleLexiconGroupForSelection(groupId: string) {
    if (bindableSelectedElements.length === 0) {
      return
    }

    const selectedIds = new Set(bindableSelectedElements.map((element) => element.id))
    const allSelectedHaveGroup = bindableSelectedElements.every((element) => (element.lexiconGroupIds ?? []).includes(groupId))

    updateDocument((current) => ({
      ...current,
      elements: current.elements.map((element) => {
        if (!selectedIds.has(element.id) || !isLexiconEnabledElement(element)) {
          return element
        }

        const currentGroupIds = element.lexiconGroupIds ?? []
        const nextGroupIds = allSelectedHaveGroup
          ? currentGroupIds.filter((id) => id !== groupId)
          : currentGroupIds.includes(groupId)
            ? currentGroupIds
            : [...currentGroupIds, groupId]

        return {
          ...element,
          lexiconGroupIds: nextGroupIds,
          defaultLexiconGroupId: nextGroupIds.includes(element.defaultLexiconGroupId ?? '') ? element.defaultLexiconGroupId : nextGroupIds[0] ?? null,
        } as LabelElement
      }),
    }))
  }

  function setSelectedElementDefaultLexiconGroup(groupId: string | null) {
    if (!isLexiconEnabledElement(selectedElement)) {
      return
    }

    updateSelectedElement({
      defaultLexiconGroupId: groupId || null,
    } as Partial<LabelElement>)
  }

  function applySuggestionToSelectedElement(text: string) {
    if (!isLexiconEnabledElement(selectedElement)) {
      return
    }

    updateSelectedElement(createContentPatch(selectedElement, text))
  }

  function openTab(nextTab: EditorTab) {
    setTabs((currentTabs) => [...currentTabs, nextTab])
    setActiveTabId(nextTab.id)
    setInteraction(null)
    setSnapLines([])
  }

  function closeTab(tabId: string) {
    const closingTab = tabs.find((tab) => tab.id === tabId)
    if (!closingTab) {
      return
    }

    if (isTabDirty(closingTab)) {
      const confirmed = window.confirm(`“${getTabDisplayName(closingTab)}”有未保存修改，确认关闭？`)
      if (!confirmed) {
        return
      }
    }

    setRecentClosedTabs((current) =>
      [
        {
          templateId: closingTab.templateId,
          document: normalizeDocument(closingTab.document),
          templateDescription: closingTab.templateDescription,
          templateTags: closingTab.templateTags,
          templateSource: closingTab.templateSource,
          selectedElementIds: closingTab.selectedElementIds,
          lastSavedSnapshot: closingTab.lastSavedSnapshot,
        },
        ...current,
      ].slice(0, recentClosedTabLimit),
    )

    setTabs((currentTabs) => {
      const currentIndex = currentTabs.findIndex((tab) => tab.id === tabId)
      const remaining = currentTabs.filter((tab) => tab.id !== tabId)

      if (tabId === activeTabId) {
        if (remaining.length === 0) {
          setActiveTabId(null)
          setStatus('工作区已清空。可新建标签、导入 DDL，或从模板库重新打开。')
        } else {
          const fallbackTab = remaining[Math.max(0, currentIndex - 1)] ?? remaining[0]
          setActiveTabId(fallbackTab?.id ?? null)
        }
      }

      return remaining
    })
    setInteraction(null)
    setSnapLines([])
  }

  function reopenLastClosedTab() {
    const [nextClosedTab, ...remaining] = recentClosedTabs
    if (!nextClosedTab) {
      return
    }

    const reopenedTab = createEditorTab(nextClosedTab.document, {
      templateId: nextClosedTab.templateId,
      templateDescription: nextClosedTab.templateDescription,
      templateTags: nextClosedTab.templateTags,
      templateSource: nextClosedTab.templateSource,
      selectedElementIds: nextClosedTab.selectedElementIds,
    })

    reopenedTab.lastSavedSnapshot = nextClosedTab.lastSavedSnapshot
    setRecentClosedTabs(remaining)
    openTab(reopenedTab)
    setStatus(`已恢复标签：${getTabDisplayName(reopenedTab)}`)
  }

  useEffect(() => {
    if (!canvasWrapRef.current || activeSurface !== 'editor' || !hasActiveTab) {
      return
    }

    const element = canvasWrapRef.current
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) {
        return
      }

      if (entry.contentRect.width < 360 || entry.contentRect.height < 240) {
        return
      }

      const availableWidth = Math.max(120, entry.contentRect.width - 28)
      const availableHeight = Math.max(120, entry.contentRect.height - 28)
      const widthScale = availableWidth / (labelDocument.widthMm * baseCanvasScale)
      const heightScale = availableHeight / (labelDocument.heightMm * baseCanvasScale)
      setCanvasViewportScale(clamp(Math.min(widthScale, heightScale, 1), 0.2, 1))
    })

    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [activeSurface, hasActiveTab, labelDocument.widthMm, labelDocument.heightMm])

  useEffect(() => {
    const validSelection = selectedElementIds.filter((id) => labelDocument.elements.some((element) => element.id === id))
    if (validSelection.length !== selectedElementIds.length) {
      setActiveSelection(validSelection)
    }
  }, [labelDocument.elements, selectedElementIds])

  useEffect(() => {
    if (!interaction) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!canvasRef.current) {
        return
      }

      const point = pointFromPointer(canvasRef.current.getBoundingClientRect(), event, canvasScale)

      if (interaction.mode === 'marquee') {
        const nextMarquee = { ...interaction, current: point }
        const bounds = getMarqueeBounds(nextMarquee.start, point)
        const hitIds = visibleElements.filter((element) => boundsIntersect(bounds, getElementBounds(element))).map((element) => element.id)
        setInteraction(nextMarquee)
        setActiveSelection(nextMarquee.additive ? Array.from(new Set([...nextMarquee.initialSelectionIds, ...hitIds])) : hitIds)
        return
      }

      if (interaction.mode === 'move') {
        const startSelection = sortElements(interaction.startDocument.elements.filter((element) => interaction.selectedIds.includes(element.id)))
        const startBounds = getSelectionBounds(startSelection)
        if (!startBounds) {
          return
        }

        let dx = point.x - interaction.start.x
        let dy = point.y - interaction.start.y

        dx = clamp(dx, -startBounds.left, interaction.startDocument.widthMm - startBounds.right)
        dy = clamp(dy, -startBounds.top, interaction.startDocument.heightMm - startBounds.bottom)

        const rawBounds = {
          ...startBounds,
          left: startBounds.left + dx,
          right: startBounds.right + dx,
          top: startBounds.top + dy,
          bottom: startBounds.bottom + dy,
          centerX: startBounds.centerX + dx,
          centerY: startBounds.centerY + dy,
        }

        const snapped = snapMoveBounds(rawBounds, interaction.startDocument, interaction.selectedIds)
        dx = clamp(dx + snapped.deltaX, -startBounds.left, interaction.startDocument.widthMm - startBounds.right)
        dy = clamp(dy + snapped.deltaY, -startBounds.top, interaction.startDocument.heightMm - startBounds.bottom)

        const next = normalizeDocument({
          ...interaction.startDocument,
          elements: interaction.startDocument.elements.map((element) =>
            interaction.selectedIds.includes(element.id)
              ? ({
                  ...element,
                  x: element.x + dx,
                  y: element.y + dy,
                } as LabelElement)
              : element,
          ),
        })

        setSnapLines(snapped.lines)
        setActiveDocument(next, { pushHistory: false })
        return
      }

      if (interaction.mode === 'resize') {
        const startElement = interaction.startDocument.elements.find((element) => element.id === interaction.elementId)
        if (!startElement) {
          return
        }

        const startBounds = getElementBounds(startElement)
        let left = startBounds.left
        let top = startBounds.top
        let right = startBounds.right
        let bottom = startBounds.bottom

        if (interaction.handle.includes('w')) {
          left = clamp(point.x, 0, startBounds.right - minElementSizeMm)
        }
        if (interaction.handle.includes('e')) {
          right = clamp(point.x, startBounds.left + minElementSizeMm, interaction.startDocument.widthMm)
        }
        if (interaction.handle.includes('n')) {
          top = clamp(point.y, 0, startBounds.bottom - minElementSizeMm)
        }
        if (interaction.handle.includes('s')) {
          bottom = clamp(point.y, startBounds.top + minElementSizeMm, interaction.startDocument.heightMm)
        }

        let nextElement: LabelElement = {
          ...startElement,
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
        } as LabelElement

        if (startElement.type === 'qrcode') {
          const textHeight = getQrTextAreaHeightMm(startElement)
          const size = Math.max(nextElement.width, nextElement.height - textHeight)
          nextElement = {
            ...nextElement,
            width: size,
            height: size + textHeight,
            x: interaction.handle.includes('w') ? startBounds.right - size : nextElement.x,
            y: interaction.handle.includes('n') ? startBounds.bottom - size - textHeight : nextElement.y,
          }
        }

        const next = normalizeDocument({
          ...interaction.startDocument,
          elements: interaction.startDocument.elements.map((element) => (element.id === interaction.elementId ? nextElement : element)),
        })

        const normalizedElement = next.elements.find((element) => element.id === interaction.elementId)
        if (!normalizedElement) {
          return
        }

        const snappedLines: SnapLine[] = []
        const targets = getSnapTargets(interaction.startDocument, [interaction.elementId])
        const resizedBounds = getElementBounds(normalizedElement)

        if (interaction.handle.includes('w') || interaction.handle.includes('e')) {
          const candidate = interaction.handle.includes('w') ? resizedBounds.left : resizedBounds.right
          const snap = findBestSnap(candidate, targets.vertical)
          if (snap.target !== null) {
            const width = interaction.handle.includes('w')
              ? startBounds.right - (resizedBounds.left + snap.delta)
              : resizedBounds.right + snap.delta - resizedBounds.left
            next.elements = next.elements.map((element) =>
              element.id === interaction.elementId
                ? normalizeElement(
                    {
                      ...element,
                      x: interaction.handle.includes('w') ? resizedBounds.left + snap.delta : resizedBounds.left,
                      width,
                    } as LabelElement,
                    next,
                    element.zIndex ?? 0,
                  )
                : element,
            )
            snappedLines.push({ orientation: 'vertical', value: snap.target })
          }
        }

        if (interaction.handle.includes('n') || interaction.handle.includes('s')) {
          const candidate = interaction.handle.includes('n') ? resizedBounds.top : resizedBounds.bottom
          const snap = findBestSnap(candidate, targets.horizontal)
          if (snap.target !== null) {
            const height = interaction.handle.includes('n')
              ? startBounds.bottom - (resizedBounds.top + snap.delta)
              : resizedBounds.bottom + snap.delta - resizedBounds.top
            next.elements = next.elements.map((element) =>
              element.id === interaction.elementId
                ? normalizeElement(
                    {
                      ...element,
                      y: interaction.handle.includes('n') ? resizedBounds.top + snap.delta : resizedBounds.top,
                      height,
                    } as LabelElement,
                    next,
                    element.zIndex ?? 0,
                  )
                : element,
            )
            snappedLines.push({ orientation: 'horizontal', value: snap.target })
          }
        }

        setSnapLines(snappedLines)
        setActiveDocument(normalizeDocument(next), { pushHistory: false })
        return
      }

      const startElement = interaction.startDocument.elements.find((element) => element.id === interaction.elementId)
      if (!startElement) {
        return
      }

      const center = {
        x: startElement.x + startElement.width / 2,
        y: startElement.y + startElement.height / 2,
      }
      const angle = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90
      const rotation = event.shiftKey ? roundTo(angle, 15) : roundTo(angle, 1)
      const next = normalizeDocument({
        ...interaction.startDocument,
        elements: interaction.startDocument.elements.map((element) =>
          element.id === interaction.elementId ? ({ ...element, rotation } as LabelElement) : element,
        ),
      })
      setActiveDocument(next, { pushHistory: false })
      setSnapLines([])
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== interaction.pointerId) {
        return
      }

      if (interaction.mode !== 'marquee') {
        pushHistoryFrom(interaction.startDocument)
      }

      setInteraction(null)
      setSnapLines([])
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [canvasScale, interaction, visibleElements])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTextInputTarget(event.target)) {
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) {
          redo()
        } else {
          undo()
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault()
        redo()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setActiveSelection(visibleElements.map((element) => element.id))
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        duplicateSelectedElements()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveCurrentTemplate()
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        if (activeTabId) {
          closeTab(activeTabId)
        }
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === ']') {
        event.preventDefault()
        reorderSelected(event.shiftKey ? 'front' : 'forward')
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.key === '[') {
        event.preventDefault()
        reorderSelected(event.shiftKey ? 'back' : 'backward')
        return
      }

      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 't') {
        event.preventDefault()
        reopenLastClosedTab()
        return
      }

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        deleteSelectedElements()
        return
      }

      const step = event.shiftKey ? 5 : 0.5
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        nudgeSelection(-step, 0)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        nudgeSelection(step, 0)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        nudgeSelection(0, -step)
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        nudgeSelection(0, step)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [labelDocument, recentClosedTabs, selectedElementIds, visibleElements])

  async function bootstrap() {
    try {
      const [stateResponse, templatesResponse, lexiconGroupsResponse, lexiconLibraryResponse] = await Promise.all([
        fetchJson<AppStateResponse>('/api/app-state'),
        fetchJson<LabelTemplateSummary[]>('/api/templates'),
        fetchJson<LexiconGroupSummary[]>('/api/lexicon-groups'),
        fetchJson<LexiconLibrary>('/api/lexicons'),
      ])

      setAppState(stateResponse)
      setTemplates(templatesResponse)
      setLexiconGroups(lexiconGroupsResponse)
      setLexiconLibrary(lexiconLibraryResponse)
      setActiveLexiconId((current) => current ?? lexiconLibraryResponse.lexicons[0]?.id ?? null)
      setActiveLexiconGroupId((current) => current ?? lexiconLibraryResponse.lexicons[0]?.groups[0]?.id ?? null)
      const savedWorkspace = readWorkspaceSnapshot()
      const restoredTabs = savedWorkspace?.tabs.map((tab) => normalizeEditorTab(tab)) ?? []

      if (restoredTabs.length > 0) {
        setTabs(restoredTabs)
        setActiveTabId(savedWorkspace?.activeTabId && restoredTabs.some((tab) => tab.id === savedWorkspace.activeTabId) ? savedWorkspace.activeTabId : restoredTabs[0].id)
        setStatus(`已恢复上次工作区，共 ${restoredTabs.length} 个标签页。`)
        return
      }

      if (templatesResponse.length > 0) {
        const template = await fetchJson<LabelTemplateRecord>(`/api/templates/${templatesResponse[0].id}`)
        const tab = createEditorTab(template.document, {
          templateId: template.id,
          templateDescription: template.description,
          templateTags: template.tags,
          templateSource: template.source,
        })
        setTabs([tab])
        setActiveTabId(tab.id)
        setStatus(`已加载模板：${template.name}`)
        return
      }

      const next = createEditorTab(createBlankDocument())
      setTabs([next])
      setActiveTabId(next.id)
      setStatus('已就绪，可以开始设计你的第一张标签。')
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function refreshTemplateLibrary() {
    setTemplates(await fetchJson<LabelTemplateSummary[]>('/api/templates'))
  }

  function upsertTemplateSummary(record: LabelTemplateRecord) {
    const summary = toTemplateSummary(record)
    setTemplates((current) => {
      const next = current.some((template) => template.id === summary.id)
        ? current.map((template) => (template.id === summary.id ? summary : template))
        : [summary, ...current]
      return next
    })
  }

  async function refreshLexiconGroups() {
    const [groups, library] = await Promise.all([
      fetchJson<LexiconGroupSummary[]>('/api/lexicon-groups'),
      fetchJson<LexiconLibrary>('/api/lexicons'),
    ])
    setLexiconGroups(groups)
    setLexiconLibrary(library)
    setActiveLexiconId((current) => current && library.lexicons.some((lexicon) => lexicon.id === current) ? current : library.lexicons[0]?.id ?? null)
    setActiveLexiconGroupId((current) =>
      current && library.lexicons.some((lexicon) => lexicon.groups.some((group) => group.id === current))
        ? current
        : library.lexicons[0]?.groups[0]?.id ?? null,
    )
  }

  async function createLexiconGroup() {
    if (!activeLexicon) {
      setStatus('词库尚未初始化。')
      return
    }

    const name = window.prompt('分组名称', '新分组')?.trim()
    if (!name) {
      return
    }

    try {
      const created = await postJson<LexiconGroup>(`/api/lexicons/${activeLexicon.id}/groups`, { name })
      await refreshLexiconGroups()
      setActiveLexiconId(activeLexicon.id)
      setActiveLexiconGroupId(created.id)
      setStatus(`已创建分组：${created.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function renameLexiconGroup(group: LexiconGroup) {
    if (!activeLexicon) {
      return
    }

    const name = window.prompt('分组名称', group.name)?.trim()
    if (!name || name === group.name) {
      return
    }

    try {
      const saved = await putJson<LexiconGroup>(`/api/lexicons/${activeLexicon.id}/groups/${group.id}`, { name })
      await refreshLexiconGroups()
      setActiveLexiconId(activeLexicon.id)
      setActiveLexiconGroupId(saved.id)
      setStatus(`已重命名分组：${saved.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function deleteLexiconGroup(group: LexiconGroup) {
    if (!activeLexicon) {
      return
    }

    const confirmed = window.confirm(`确认删除分组“${group.name}”？其中的条目也会一并删除。`)
    if (!confirmed) {
      return
    }

    try {
      await deleteJson(`/api/lexicons/${activeLexicon.id}/groups/${group.id}`)
      await refreshLexiconGroups()
      setActiveLexiconId(activeLexicon.id)
      setStatus(`已删除分组：${group.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function createLexiconEntry() {
    if (!activeLexicon || !activeLexiconGroup) {
      setStatus('请先选择一个分组。')
      return
    }

    const text = window.prompt('条目内容')?.trim()
    if (!text) {
      return
    }

    try {
      await postJson<LexiconEntry>(`/api/lexicons/${activeLexicon.id}/groups/${activeLexiconGroup.id}/entries`, { text })
      await refreshLexiconGroups()
      setActiveLexiconId(activeLexicon.id)
      setActiveLexiconGroupId(activeLexiconGroup.id)
      setStatus('已添加词库条目。')
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function updateLexiconEntry(entry: LexiconEntry, text: string) {
    if (!activeLexicon || !activeLexiconGroup || !text.trim() || text === entry.text) {
      return
    }

    try {
      await putJson<LexiconEntry>(`/api/lexicons/${activeLexicon.id}/groups/${activeLexiconGroup.id}/entries/${entry.id}`, { text: text.trim() })
      await refreshLexiconGroups()
      setActiveLexiconId(activeLexicon.id)
      setActiveLexiconGroupId(activeLexiconGroup.id)
      setStatus('已更新词库条目。')
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function deleteLexiconEntry(entry: LexiconEntry) {
    if (!activeLexicon || !activeLexiconGroup) {
      return
    }

    const confirmed = window.confirm(`确认删除条目“${entry.text}”？`)
    if (!confirmed) {
      return
    }

    try {
      await deleteJson(`/api/lexicons/${activeLexicon.id}/groups/${activeLexiconGroup.id}/entries/${entry.id}`)
      await refreshLexiconGroups()
      setActiveLexiconId(activeLexicon.id)
      setActiveLexiconGroupId(activeLexiconGroup.id)
      setStatus('已删除词库条目。')
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  function applySavedTemplateToTabs(saved: LabelTemplateRecord, savingTabId: string, snapshotAtSaveStart: string) {
    const normalized = normalizeDocument(saved.document)
    const savedSnapshot = serializeTabSnapshot({
      document: normalized,
      templateDescription: saved.description,
      templateTags: saved.tags,
      templateSource: saved.source,
    })

    setTabs((currentTabs) =>
      currentTabs.map((tab) => {
        if (tab.id !== savingTabId) {
          return tab
        }

        const tabSnapshot = serializeTabSnapshot(tab)
        if (tabSnapshot === snapshotAtSaveStart) {
          return {
            ...tab,
            templateId: saved.id,
            document: normalized,
            templateDescription: saved.description,
            templateTags: saved.tags,
            templateSource: saved.source,
            lastSavedSnapshot: savedSnapshot,
          }
        }

        return {
          ...tab,
          templateId: saved.id,
          templateDescription: saved.description,
          templateTags: saved.tags,
          templateSource: saved.source,
          lastSavedSnapshot: savedSnapshot,
        }
      }),
    )
  }

  function pushHistoryFrom(startDocument: LabelDocument) {
    const current = documentRef.current
    if (serializeDocument(startDocument) === serializeDocument(current)) {
      return
    }

    updateActiveTab((tab) => ({
      ...tab,
      history: {
        past: [...historyRef.current.past, normalizeDocument(startDocument)].slice(-historyLimit),
        future: [],
      },
    }))
  }

  function applyDocument(nextDocument: LabelDocument, options?: { pushHistory?: boolean }) {
    setActiveDocument(nextDocument, options)
  }

  function updateDocument(mutator: (current: LabelDocument) => LabelDocument, options?: { pushHistory?: boolean }) {
    applyDocument(mutator(documentRef.current), options)
  }

  async function loadTemplate(id: string) {
    const template = await fetchJson<LabelTemplateRecord>(`/api/templates/${id}`)
    const existingTab = tabsRef.current.find((tab) => tab.templateId === template.id)
    if (existingTab) {
      showEditor(existingTab.id)
      setStatus(`已切换到模板：${template.name}`)
      return
    }

    const normalized = normalizeDocument(template.document)
    openTab(
      createEditorTab(normalized, {
        templateId: template.id,
        templateDescription: template.description,
        templateTags: template.tags,
        templateSource: template.source,
      }),
    )
    setStatus(`已加载模板：${template.name}`)
  }

  async function saveCurrentTemplate() {
    if (!activeTab) {
      return
    }

    if (!activeTemplateId) {
      await saveAsTemplate()
      return
    }

    const savingTabId = activeTab.id
    const snapshotAtSaveStart = currentSnapshot
    setSaving(true)
    try {
      const saved = await putJson<LabelTemplateRecord>(`/api/templates/${activeTemplateId}`, {
        name: labelDocument.name,
        description: templateDescription,
        tags: templateTags,
        source: templateSource,
        document: labelDocument,
      })

      applySavedTemplateToTabs(saved, savingTabId, snapshotAtSaveStart)
      upsertTemplateSummary(saved)
      setStatus(`已保存模板：${saved.name}`)
      queueActivity(`已保存模板：${saved.name}`)
      await refreshTemplateLibrary()
    } catch (error) {
      setStatus(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function saveAsTemplate() {
    if (!activeTab) {
      return
    }

    const suggestedName = labelDocument.name?.trim() || '未命名标签'
    const targetName = window.prompt('另存为模板名称', suggestedName)?.trim()
    if (!targetName) {
      return
    }

    const savingTabId = activeTab.id
    const snapshotAtSaveStart = currentSnapshot
    setSaving(true)
    try {
      const saved = await postJson<LabelTemplateRecord>('/api/templates', {
        name: targetName,
        description: templateDescription,
        tags: templateTags,
        source: activeTemplateId ? 'duplicate' : templateSource === 'blank' ? 'manual' : templateSource,
        document: {
          ...labelDocument,
          name: targetName,
        },
      })

      applySavedTemplateToTabs(saved, savingTabId, snapshotAtSaveStart)
      upsertTemplateSummary(saved)
      setStatus(`已另存为模板：${saved.name}`)
      queueActivity(`已另存为模板：${saved.name}`)
      await refreshTemplateLibrary()
    } catch (error) {
      setStatus(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  async function renameTemplate(template: LabelTemplateSummary) {
    const nextName = window.prompt('输入新的模板名称', template.name)?.trim()
    if (!nextName || nextName === template.name) {
      return
    }

    try {
      const saved = await patchJson<LabelTemplateRecord, UpdateTemplateMetaRequest>(`/api/templates/${template.id}/meta`, {
        name: nextName,
        description: template.description,
        tags: template.tags,
      })

      setTabs((currentTabs) =>
        currentTabs.map((tab) => {
          if (tab.templateId !== saved.id) {
            return tab
          }

          const lastSavedDocument = parseSerializedDocument(tab.lastSavedSnapshot)
          return {
            ...tab,
            document: normalizeDocument({
              ...tab.document,
              name: saved.name,
            }),
            templateDescription: saved.description,
            templateTags: saved.tags,
            templateSource: saved.source,
            lastSavedSnapshot: serializeTabSnapshot({
              document: {
                ...(lastSavedDocument ?? tab.document),
                name: saved.name,
              },
              templateDescription: saved.description,
              templateTags: saved.tags,
              templateSource: saved.source,
            }),
          }
        }),
      )
      await refreshTemplateLibrary()
      setStatus(`已重命名模板：${saved.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function duplicateTemplate(template: LabelTemplateSummary) {
    const nextName = window.prompt('复制后的模板名称', `${template.name} 副本`)?.trim()
    if (!nextName) {
      return
    }

    try {
      const duplicated = await postJson<LabelTemplateRecord>(`/api/templates/${template.id}/duplicate`, {
        name: nextName,
      } as DuplicateTemplateRequest)
      await refreshTemplateLibrary()
      openTab(
        createEditorTab(duplicated.document, {
          templateId: duplicated.id,
          templateDescription: duplicated.description,
          templateTags: duplicated.tags,
          templateSource: duplicated.source,
        }),
      )
      setActiveSurface('editor')
      setStatus(`已复制模板：${duplicated.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function deleteTemplate(template: LabelTemplateSummary) {
    const confirmed = window.confirm(`确认删除模板“${template.name}”？已打开的编辑内容会保留为未绑定草稿。`)
    if (!confirmed) {
      return
    }

    try {
      await deleteJson(`/api/templates/${template.id}`)
      setTabs((currentTabs) =>
        currentTabs.map((tab) =>
          tab.templateId === template.id
            ? {
                ...tab,
                templateId: null,
                templateSource: 'manual',
                lastSavedSnapshot: serializeTabSnapshot({
                  document: tab.document,
                  templateDescription: tab.templateDescription,
                  templateTags: tab.templateTags,
                  templateSource: 'manual',
                }),
              }
            : tab,
        ),
      )
      await refreshTemplateLibrary()
      setStatus(`已删除模板：${template.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function printCurrent() {
    if (!currentPrinter) {
      setStatus('没有发现可用打印机，请连接设备后刷新状态。')
      return
    }

    if (!currentPrinter.isAvailable) {
      setStatus(`打印机“${currentPrinter.displayName}”离线：${currentPrinter.statusMessage}`)
      return
    }

    setPrinting(true)
    try {
      const response = await postJson<PrintResult>('/api/print', {
        document: labelDocument,
        devicePathOverride: currentPrinter.devicePath,
      })

      setStatus(`打印已发送到设备：${response.devicePath}`)
      queueActivity(`已打印：${labelDocument.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    } finally {
      setPrinting(false)
    }
  }

  async function refreshPrinters() {
    setRefreshingPrinters(true)
    try {
      const printers = await fetchJson<AppStateResponse['printers']>('/api/printers')
      setAppState((current) => (current ? { ...current, printers } : current))
      const onlineCount = printers.filter((printer) => printer.isAvailable).length
      setStatus(`已刷新打印机状态：${onlineCount}/${printers.length} 台在线。`)
    } catch (error) {
      setStatus(`刷新打印机状态失败：${getErrorMessage(error)}`)
    } finally {
      setRefreshingPrinters(false)
    }
  }

  function queueActivity(entry: string) {
    setActivity((current) => [entry, ...current.filter((item) => item !== entry)].slice(0, 8))
  }

  function createFreshDocument() {
    const next = createBlankDocument('快速标签')
    next.printerDevicePath = labelDocument.printerDevicePath
    openTab(createEditorTab(next, { templateId: null, templateSource: 'blank' }))
    setStatus('已新建标签。')
  }

  function handleImageUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      const element = createElement('image', documentRef.current, {
        dataUrl,
        width: 18,
        height: 12,
        y: 6,
      } as Partial<ImageElement>)

      updateDocument((current) => ({
        ...current,
        elements: reindexElements([...current.elements, element]),
      }))
      setActiveSelection([element.id])
    }
    reader.readAsDataURL(file)
    event.target.value = ''
  }

  async function handleDdlUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    try {
      const ddlSource = await file.text()
      const imported = importDlabelTemplate(ddlSource, file.name)
      openTab(createEditorTab(imported.document, { templateId: null, templateSource: 'ddl-import', templateDescription: imported.warnings.join('；') }))
      queueActivity(`已导入 DDL：${imported.document.name}`)
      setStatus(
        imported.warnings.length > 0
          ? `已导入 DDL：${imported.document.name} · ${imported.warnings.join('；')}`
          : `已导入 DDL：${imported.document.name}`,
      )
    } catch (error) {
      setStatus(`DDL 导入失败：${getErrorMessage(error)}`)
    }
  }

  function addNewElement(type: LabelElement['type']) {
    const element = createElement(type, documentRef.current)
    updateDocument((current) => ({
      ...current,
      elements: reindexElements([...current.elements, element]),
    }))
    setActiveSelection([element.id])
  }

  function updateSelectedElement(patch: Partial<LabelElement>) {
    if (!selectedElement) {
      return
    }

    updateDocument((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        element.id === selectedElement.id ? normalizeElement({ ...element, ...patch } as LabelElement, current, element.zIndex ?? 0) : element,
      ),
    }))
  }

  function updateElementName(id: string, name: string) {
    updateDocument((current) => ({
      ...current,
      elements: current.elements.map((element) => (element.id === id ? ({ ...element, name } as LabelElement) : element)),
    }))
  }

  function updateElementById(id: string, patch: Partial<LabelElement>) {
    updateDocument((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        element.id === id ? normalizeElement({ ...element, ...patch } as LabelElement, current, element.zIndex ?? 0) : element,
      ),
    }))
  }

  function setDocumentField<K extends keyof LabelDocument>(field: K, value: LabelDocument[K]) {
    updateDocument((current) => ({ ...current, [field]: value }))
  }

  function deleteSelectedElements() {
    if (selectedElementIds.length === 0) {
      return
    }

    const removedCount = selectedElementIds.length
    updateDocument((current) => ({
      ...current,
      elements: reindexElements(current.elements.filter((element) => !selectedElementIds.includes(element.id))),
    }))
    setActiveSelection([])
    queueActivity(`已删除 ${removedCount} 个元素`)
  }

  function duplicateSelectedElements() {
    if (selectedElementIds.length === 0) {
      return
    }

    updateDocument((current) => {
      const selected = sortElements(current.elements.filter((element) => selectedElementIds.includes(element.id)))
      let nextZIndex = current.elements.length
      const duplicates = selected.map((element) => {
        const duplicate = normalizeElement(
          {
            ...element,
            id: createId(),
            x: element.x + 1,
            y: element.y + 1,
            name: `${element.name ?? getDefaultElementName(element.type)} 副本`,
            zIndex: nextZIndex,
          } as LabelElement,
          current,
          nextZIndex,
        )
        nextZIndex += 1
        return duplicate
      })

      setActiveSelection(duplicates.map((element) => element.id))
      queueActivity(`已复制 ${duplicates.length} 个元素`)
      return {
        ...current,
        elements: reindexElements([...current.elements, ...duplicates]),
      }
    })
  }

  function nudgeSelection(deltaX: number, deltaY: number) {
    if (selectedElementIds.length === 0) {
      return
    }

    updateDocument((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedElementIds.includes(element.id)
          ? normalizeElement(
              {
                ...element,
                x: element.x + deltaX,
                y: element.y + deltaY,
              } as LabelElement,
              current,
              element.zIndex ?? 0,
            )
          : element,
      ),
    }))
  }

  function reorderSelected(action: LayerAction) {
    if (selectedElementIds.length === 0) {
      return
    }

    updateDocument((current) => ({
      ...current,
      elements: reorderElements(current.elements, selectedElementIds, action),
    }))
    const actionLabel: Record<LayerAction, string> = {
      front: '置顶',
      back: '置底',
      forward: '上移一层',
      backward: '下移一层',
    }
    setStatus(`已${actionLabel[action]}：${selectedElementIds.length} 个元素`)
  }

  function toggleLock(id: string) {
    const element = labelDocument.elements.find((item) => item.id === id)
    if (!element) {
      return
    }

    updateElementById(id, { locked: !element.locked })
  }

  function toggleHidden(id: string) {
    const element = labelDocument.elements.find((item) => item.id === id)
    if (!element) {
      return
    }

    updateElementById(id, { hidden: !element.hidden })
  }

  function undo() {
    const previous = historyRef.current.past.at(-1)
    if (!previous) {
      return
    }

    const nextPast = historyRef.current.past.slice(0, -1)
    const nextFuture = [documentRef.current, ...historyRef.current.future].slice(0, historyLimit)
    updateActiveTab((tab) => ({
      ...tab,
      history: { past: nextPast, future: nextFuture },
      document: normalizeDocument(previous),
    }))
    setSnapLines([])
    setInteraction(null)
  }

  function redo() {
    const [next, ...remaining] = historyRef.current.future
    if (!next) {
      return
    }

    updateActiveTab((tab) => ({
      ...tab,
      history: {
        past: [...historyRef.current.past, documentRef.current].slice(-historyLimit),
        future: remaining,
      },
      document: normalizeDocument(next),
    }))
    setSnapLines([])
    setInteraction(null)
  }

  function handleCanvasPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || !canvasRef.current) {
      return
    }

    const point = pointFromPointer(canvasRef.current.getBoundingClientRect(), event, canvasScale)
    setInteraction({
      mode: 'marquee',
      pointerId: event.pointerId,
      start: point,
      current: point,
      additive: event.ctrlKey || event.metaKey,
      initialSelectionIds: event.ctrlKey || event.metaKey ? selectedElementIds : [],
    })

    if (!event.ctrlKey && !event.metaKey) {
      setActiveSelection([])
    }
  }

  function handleCanvasWrapPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.target instanceof Node && canvasRef.current?.contains(event.target)) {
      return
    }

    setActiveSelection([])
    setInteraction(null)
    setSnapLines([])
  }

  function handleCanvasWheel(event: ReactWheelEvent<HTMLDivElement>) {
    event.preventDefault()
    event.stopPropagation()

    const direction = event.deltaY < 0 ? 1 : -1
    const factor = direction > 0 ? 1.08 : 1 / 1.08
    setCanvasUserZoom((current) => clamp(roundTo(current * factor, 0.01), 0.25, 4))
  }

  function handleElementPointerDown(element: LabelElement, event: ReactPointerEvent<HTMLDivElement>) {
    event.stopPropagation()
    event.preventDefault()
    if (!canvasRef.current || event.button !== 0) {
      return
    }

    const point = pointFromPointer(canvasRef.current.getBoundingClientRect(), event, canvasScale)
    if (event.altKey) {
      const stack = getElementsAtPoint(documentRef.current, point)
      const reversed = [...stack].reverse()
      const currentIndex = reversed.findIndex((item) => item.id === element.id)
      const fallback = reversed.find((item) => item.id !== element.id)
      const next = currentIndex >= 0 ? reversed[currentIndex + 1] ?? reversed[0] : fallback
      if (next) {
        setActiveSelection([next.id])
        setStatus(`已切换到下层：${next.name ?? getDefaultElementName(next.type)}`)
      }
      return
    }

    const additive = event.ctrlKey || event.metaKey
    const alreadySelected = selectedElementIds.includes(element.id)
    const nextSelection = additive
      ? alreadySelected
        ? selectedElementIds.filter((id) => id !== element.id)
        : [...selectedElementIds, element.id]
      : alreadySelected && selectedElementIds.length > 1
        ? selectedElementIds
        : [element.id]

    setActiveSelection(nextSelection)
    if (additive || element.locked) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    setInteraction({
      mode: 'move',
      pointerId: event.pointerId,
      start: point,
      startDocument: documentRef.current,
      selectedIds: nextSelection,
    })
  }

  function handleResizeHandlePointerDown(handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation()
    event.preventDefault()
    if (!selectedElement || selectedElement.locked || !canvasRef.current) {
      return
    }

    const point = pointFromPointer(canvasRef.current.getBoundingClientRect(), event, canvasScale)
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteraction({
      mode: 'resize',
      pointerId: event.pointerId,
      start: point,
      startDocument: documentRef.current,
      elementId: selectedElement.id,
      handle,
    })
  }

  function handleRotatePointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    event.stopPropagation()
    event.preventDefault()
    if (!selectedElement || selectedElement.locked || !canvasRef.current) {
      return
    }

    const point = pointFromPointer(canvasRef.current.getBoundingClientRect(), event, canvasScale)
    event.currentTarget.setPointerCapture(event.pointerId)
    setInteraction({
      mode: 'rotate',
      pointerId: event.pointerId,
      start: point,
      startDocument: documentRef.current,
      elementId: selectedElement.id,
    })
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-leading">
          <div
            className="title-block"
            onMouseDown={(event) => {
              if (event.button === 0) {
                sendWindowChromeCommand('drag')
              }
            }}
            onDoubleClick={() => sendWindowChromeCommand('toggle-maximize')}
          >
            <span className="product-mark">YiboLabel</span>
            <h1>YiboLabel</h1>
          </div>
        </div>
        <div className="topbar-actions command-bar">
          <button className={clsx('ghost-button compact-button', activeSurface === 'templates' && 'active')} onClick={() => toggleSurface('templates')}>
            模板库
          </button>
          <button className={clsx('ghost-button compact-button', activeSurface === 'lexicons' && 'active')} onClick={() => toggleSurface('lexicons')}>
            <BookOpen size={14} />
            词库
          </button>
          <button className={clsx('ghost-button compact-button', showDocumentDialog && 'active')} onClick={() => setShowDocumentDialog(true)} disabled={!hasActiveTab}>
            文档与打印
          </button>
          <button className="ghost-button" onClick={undo} disabled={!hasActiveTab || history.past.length === 0}>
            撤销
          </button>
          <button className="ghost-button" onClick={redo} disabled={!hasActiveTab || history.future.length === 0}>
            重做
          </button>
          <button className="ghost-button" onClick={() => ddlInputRef.current?.click()}>
            <Upload size={16} />
            导入 DDL
          </button>
          <button className="ghost-button compact-button" onClick={reopenLastClosedTab} disabled={recentClosedTabs.length === 0}>
            <RotateCcw size={14} />
            恢复关闭
          </button>
          <div className={clsx('topbar-printer', currentPrinter?.isAvailable ? 'online' : 'offline')}>
            <span className="printer-status-dot" aria-hidden="true" />
            <label>
              <span>打印机</span>
              <select
                aria-label="选择打印机"
                value={labelDocument.printerDevicePath ?? appState?.printers[0]?.devicePath ?? ''}
                onChange={(event) => setDocumentField('printerDevicePath', event.target.value)}
                disabled={!hasActiveTab || !appState?.printers.length}
              >
                {appState?.printers.length ? (
                  appState.printers.map((printer) => (
                    <option key={printer.id} value={printer.devicePath}>
                      {printer.isAvailable ? '在线' : '离线'} · {printer.displayName}
                    </option>
                  ))
                ) : (
                  <option value="">未发现打印机</option>
                )}
              </select>
            </label>
            <button className="inline-icon-button" type="button" onClick={() => void refreshPrinters()} disabled={refreshingPrinters} title={currentPrinter?.statusMessage ?? '刷新打印机状态'} aria-label="刷新打印机状态">
              <RefreshCw size={14} className={refreshingPrinters ? 'is-spinning' : undefined} />
            </button>
          </div>
          <button className="action-button" onClick={() => void saveCurrentTemplate()} disabled={!hasActiveTab || saving}>
            <Save size={16} />
            {saving ? '保存中...' : activeTemplateId ? '保存' : '保存为模板'}
          </button>
          <button className="ghost-button" onClick={() => void saveAsTemplate()} disabled={!hasActiveTab || saving}>
            <Save size={16} />
            另存为
          </button>
          <button className="print-button" onClick={printCurrent} disabled={!hasActiveTab || printing || !currentPrinter?.isAvailable} title={currentPrinter?.isAvailable ? undefined : currentPrinter?.statusMessage ?? '没有可用打印机'}>
            <Printer size={16} />
            {printing ? '打印中...' : '立即打印'}
          </button>
        </div>
        <div className="window-controls" aria-label="窗口控制">
          <button className="window-control-button" type="button" onClick={() => sendWindowChromeCommand('minimize')} aria-label="最小化">
            —
          </button>
          <button className="window-control-button" type="button" onClick={() => sendWindowChromeCommand('toggle-maximize')} aria-label="最大化或还原">
            □
          </button>
          <button className="window-control-button close" type="button" onClick={() => sendWindowChromeCommand('close')} aria-label="关闭">
            ×
          </button>
        </div>
      </header>

      <section className="tab-row">
        <div className="tab-strip" aria-label="打开的标签页">
          {tabs.length === 0 ? (
            <>
              <div className="tab-strip-empty">当前没有打开的标签页</div>
              <button className="new-tab-button" type="button" onClick={createFreshDocument} title="新建标签" aria-label="新建标签">
                <FilePlus2 size={16} />
              </button>
            </>
          ) : (
            <>
              {tabs.map((tab) => {
                const tabDirty = isTabDirty(tab)
                return (
                  <div key={tab.id} className={clsx('editor-tab', activeSurface === 'editor' && activeTabId === tab.id && 'active', tabDirty && 'dirty')}>
                    <button
                      className="editor-tab-trigger"
                      onClick={() => {
                        showEditor(tab.id)
                      }}
                      onAuxClick={(event) => {
                        if (event.button === 1) {
                          closeTab(tab.id)
                        }
                      }}
                    >
                      <strong>{getTabDisplayName(tab)}</strong>
                      {tabDirty ? <em className="tab-dirty" aria-label="有未保存修改" /> : null}
                    </button>
                    <button
                      className="editor-tab-close"
                      aria-label={`关闭 ${getTabDisplayName(tab)}`}
                      onClick={() => closeTab(tab.id)}
                    >
                      ×
                    </button>
                  </div>
                )
              })}
              <button className="new-tab-button" type="button" onClick={createFreshDocument} title="新建标签" aria-label="新建标签">
                <FilePlus2 size={16} />
              </button>
            </>
          )}
        </div>
      </section>

      <main className={clsx('workspace', activeSurface !== 'editor' && 'library-mode')}>
        {activeSurface === 'templates' ? (
          <section className="canvas-panel templates-workspace">
            <>
              <div className="panel-heading template-browser-head">
                <div>
                  <span>模板库</span>
                  <p className="panel-note">打开、搜索和管理本地模板，或新建空白标签开始编辑。</p>
                </div>
                <div className="command-bar">
                  <button className="ghost-button compact-button" onClick={createFreshDocument}>
                    <FilePlus2 size={14} />
                    新建标签
                  </button>
                  <button className="ghost-button compact-button" onClick={() => ddlInputRef.current?.click()}>
                    <Upload size={14} />
                    导入 DDL
                  </button>
                </div>
              </div>
              <div className="field-row">
                <label>
                  搜索模板
                  <input value={templateQuery} onChange={(event) => setTemplateQuery(event.target.value)} placeholder="按名称、描述或标签搜索" />
                </label>
                <label>
                  排序
                  <select value={templateSort} onChange={(event) => setTemplateSort(event.target.value as TemplateSort)}>
                    <option value="updated-desc">最近更新优先</option>
                    <option value="updated-asc">最早更新优先</option>
                    <option value="created-desc">最近创建优先</option>
                    <option value="created-asc">最早创建优先</option>
                    <option value="name-asc">名称 A-Z</option>
                    <option value="name-desc">名称 Z-A</option>
                  </select>
                </label>
              </div>
              <div className="template-browser-grid">
                {visibleTemplates.length === 0 ? (
                  <div className="empty-workspace">
                    <div className="empty-workspace-copy">
                      <h2>{templates.length === 0 ? '还没有本地模板' : '没有匹配的模板'}</h2>
                      <p>{templates.length === 0 ? '先新建一个标签并保存，或导入一份 DDL 模板。' : '试试调整搜索词或排序方式。'}</p>
                    </div>
                    <div className="empty-workspace-actions">
                      <button className="action-button" onClick={createFreshDocument}>
                        <FilePlus2 size={16} />
                        新建标签
                      </button>
                      <button className="ghost-button" onClick={() => ddlInputRef.current?.click()}>
                        <Upload size={16} />
                        导入 DDL
                      </button>
                    </div>
                  </div>
                ) : (
                  visibleTemplates.map((template) => (
                    <div
                      key={template.id}
                      className={clsx('template-card template-card-large', openedTemplateState.get(template.id)?.current && 'active')}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        void loadTemplate(template.id)
                        setActiveSurface('editor')
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          void loadTemplate(template.id)
                          setActiveSurface('editor')
                        }
                      }}
                    >
                      <div className="template-card-head">
                        <strong>{template.name}</strong>
                        <div className="template-flags">
                          {openedTemplateState.get(template.id)?.current ? <span className="template-flag current">当前</span> : null}
                          {openedTemplateState.get(template.id)?.openCount ? <span className="template-flag open">已打开 {openedTemplateState.get(template.id)?.openCount}</span> : null}
                          {openedTemplateState.get(template.id)?.dirty ? <span className="template-flag dirty">有修改</span> : null}
                        </div>
                      </div>
                      <span>{template.description || `来源：${formatTemplateSource(template.source)}`}</span>
                      <span>
                        {template.widthMm} × {template.heightMm} mm · {template.elementCount} 个元素
                      </span>
                      {template.tags.length > 0 ? <small>标签：{template.tags.join('、')}</small> : null}
                      <small>更新于 {new Date(template.updatedAt).toLocaleString()}</small>
                      <div className="command-bar">
                        <button
                          className="mini-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void duplicateTemplate(template)
                          }}
                        >
                          复制
                        </button>
                        <button
                          className="mini-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void renameTemplate(template)
                          }}
                        >
                          重命名
                        </button>
                        <button
                          className="mini-button"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void deleteTemplate(template)
                          }}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          </section>
        ) : activeSurface === 'lexicons' ? (
          <LexiconManager
            library={lexiconLibrary}
            activeGroup={activeLexiconGroup}
            filteredEntries={filteredLexiconEntries}
            query={lexiconQuery}
            onQueryChange={setLexiconQuery}
            onSelectGroup={(group) => setActiveLexiconGroupId(group.id)}
            onCreateGroup={() => void createLexiconGroup()}
            onRenameGroup={(group) => void renameLexiconGroup(group)}
            onDeleteGroup={(group) => void deleteLexiconGroup(group)}
            onCreateEntry={() => void createLexiconEntry()}
            onUpdateEntry={(entry, text) => void updateLexiconEntry(entry, text)}
            onDeleteEntry={(entry) => void deleteLexiconEntry(entry)}
          />
        ) : (
          <>
            <aside className="sidebar">
              <section className="panel insert-panel">
                <div className="panel-heading">
                  <span>插入对象</span>
                  <span>{labelDocument.elements.length}</span>
                </div>
                <div className="tool-grid">
                  <ToolButton icon={<Type size={16} />} label="文本" onClick={() => addNewElement('text')} />
                  <ToolButton icon={<ScanBarcode size={16} />} label="条码" onClick={() => addNewElement('barcode')} />
                  <ToolButton icon={<QrCode size={16} />} label="二维码" onClick={() => addNewElement('qrcode')} />
                  <ToolButton icon={<Minus size={16} />} label="线条" onClick={() => addNewElement('line')} />
                  <ToolButton icon={<Square size={16} />} label="矩形" onClick={() => addNewElement('rectangle')} />
                  <ToolButton icon={<ImagePlus size={16} />} label="图片" onClick={() => fileInputRef.current?.click()} />
                </div>
                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageUpload} />
              </section>

              <section className="panel layers-panel">
                <div className="panel-heading panel-heading-button">
                  <button className="collapse-trigger" onClick={() => setLayersCollapsed((current) => !current)}>
                    <span className="panel-title-with-icon">
                      <Layers size={15} />
                      图层
                    </span>
                    <strong>{selectedElementIds.length > 0 ? `${selectedElementIds.length} / ${sortedElements.length}` : sortedElements.length}</strong>
                  </button>
                </div>
                {!layersCollapsed ? (
                  <>
                    <div className="layer-toolbar" aria-label="层级操作">
                      <LayerActionButton icon={<ChevronsUp size={14} />} label="置顶" disabled={selectedElementIds.length === 0} onClick={() => reorderSelected('front')} />
                      <LayerActionButton icon={<ArrowUp size={14} />} label="上移" disabled={selectedElementIds.length === 0} onClick={() => reorderSelected('forward')} />
                      <LayerActionButton icon={<ArrowDown size={14} />} label="下移" disabled={selectedElementIds.length === 0} onClick={() => reorderSelected('backward')} />
                      <LayerActionButton icon={<ChevronsDown size={14} />} label="置底" disabled={selectedElementIds.length === 0} onClick={() => reorderSelected('back')} />
                    </div>
                    <div className="layer-list">
                      {!hasActiveTab ? (
                        <p className="empty-note">当前没有打开的文件，所以也没有可管理的图层。</p>
                      ) : sortedElements.length === 0 ? (
                        <p className="empty-note">还没有对象。先从上方插入文本、条码、二维码或形状。</p>
                      ) : (
                        [...sortedElements].reverse().map((element) => (
                          <div key={element.id} className={clsx('layer-row', selectedElementIds.includes(element.id) && 'selected')}>
                            <button
                              className="layer-main"
                              type="button"
                              onClick={(event) => {
                                const additive = event.ctrlKey || event.metaKey
                                if (!additive) {
                                  setActiveSelection([element.id])
                                  return
                                }

                                setActiveSelection(
                                  selectedElementIds.includes(element.id)
                                    ? selectedElementIds.filter((id) => id !== element.id)
                                    : [...selectedElementIds, element.id],
                                )
                              }}
                            >
                              <span className="layer-name-row">
                                <strong>{element.name}</strong>
                                <small>{getLayerPositionLabel(element, sortedElements.length)}</small>
                              </span>
                              <span>{getLayerMeta(element)}</span>
                            </button>
                            <div className="layer-actions">
                              <button className={clsx('mini-button layer-icon-button', element.hidden && 'active')} type="button" onClick={() => toggleHidden(element.id)} title={element.hidden ? '显示元素' : '隐藏元素'} aria-label={element.hidden ? '显示元素' : '隐藏元素'}>
                                {element.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                              </button>
                              <button className={clsx('mini-button layer-icon-button', element.locked && 'active')} type="button" onClick={() => toggleLock(element.id)} title={element.locked ? '解锁元素' : '锁定元素'} aria-label={element.locked ? '解锁元素' : '锁定元素'}>
                                {element.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <p className="panel-note">上方按钮调整选中对象层级；Ctrl + 点击图层可多选，Alt + 点击画布可穿透选择下层对象。</p>
                  </>
                ) : null}
              </section>
            </aside>

            <section className="canvas-panel">
              {hasActiveTab ? (
                <>
                  <div className="canvas-toolbar canvas-toolbar-compact">
                    <div className="canvas-toolbar-group">
                      <button className="mini-button" disabled={selectedElementIds.length === 0} onClick={duplicateSelectedElements}>
                        复制所选
                      </button>
                      <button className="mini-button" disabled={selectedElementIds.length === 0} onClick={deleteSelectedElements}>
                        删除所选
                      </button>
                      <button className={clsx('mini-button', groupBinderOpen && 'active')} disabled={bindableSelectedElements.length === 0} onClick={() => setGroupBinderOpen((open) => !open)}>
                        分组绑定
                      </button>
                      <button className={clsx('mini-button', contentPickerOpen && 'active')} disabled={!isLexiconEnabledElement(selectedElement)} onClick={() => setContentPickerOpen((open) => !open)}>
                        内容候选
                      </button>
                    </div>
                    <div className="canvas-metrics">
                      <div>
                        <span>对象数</span>
                        <strong>{labelDocument.elements.length}</strong>
                      </div>
                      <div>
                        <span>选中元素</span>
                        <strong>{selectedElementIds.length}</strong>
                      </div>
                      <div>
                        <span>可见元素</span>
                        <strong>{visibleElements.length}</strong>
                      </div>
                    </div>
                    <p className="canvas-toolbar-tip">Ctrl 多选，Alt 选下层，方向键微调</p>
                  </div>

                  <div ref={canvasWrapRef} className="canvas-wrap" onPointerDown={handleCanvasWrapPointerDown} onWheel={handleCanvasWheel}>
                    <div className="canvas-ruler-frame">
                      <div className="ruler-corner" />
                      <div className="ruler ruler-horizontal" style={{ width: `${labelDocument.widthMm * canvasScale}px` }}>
                        {horizontalRulerTicks.map((tick) => (
                          <span
                            key={tick.value}
                            className={clsx('ruler-tick', tick.major && 'major')}
                            style={{ left: `${tick.value * canvasScale}px` }}
                          >
                            {tick.major ? tick.value : null}
                          </span>
                        ))}
                      </div>
                      <div className="ruler ruler-vertical" style={{ height: `${labelDocument.heightMm * canvasScale}px` }}>
                        {verticalRulerTicks.map((tick) => (
                          <span
                            key={tick.value}
                            className={clsx('ruler-tick', tick.major && 'major')}
                            style={{ top: `${tick.value * canvasScale}px` }}
                          >
                            {tick.major ? tick.value : null}
                          </span>
                        ))}
                      </div>
                      <div
                        ref={canvasRef}
                        id="label-canvas"
                        className="label-canvas"
                        style={{
                          width: `${labelDocument.widthMm * canvasScale}px`,
                          height: `${labelDocument.heightMm * canvasScale}px`,
                        }}
                        onPointerDown={handleCanvasPointerDown}
                      >
                        <div className="grid-overlay" />
                        {resolvedVisibleElements.map((element) => (
                        <div
                          key={element.id}
                          className={clsx(
                            'canvas-element',
                            selectedElementIds.includes(element.id) && 'selected',
                            element.locked && 'locked',
                          )}
                          style={{
                            left: `${element.x * canvasScale}px`,
                            top: `${element.y * canvasScale}px`,
                            width: `${element.width * canvasScale}px`,
                            height: `${element.height * canvasScale}px`,
                            transform: `rotate(${element.rotation}deg)`,
                            zIndex: element.zIndex ?? 0,
                          }}
                          onPointerDown={(event) => handleElementPointerDown(element, event)}
                        >
                          <ElementPreview element={element} canvasScale={canvasScale} />
                        </div>
                        ))}

                        {selectionBounds && (
                        <div
                          className="selection-outline"
                          style={{
                            left: `${selectionBounds.left * canvasScale}px`,
                            top: `${selectionBounds.top * canvasScale}px`,
                            width: `${selectionBounds.width * canvasScale}px`,
                            height: `${selectionBounds.height * canvasScale}px`,
                            transform: selectedElement ? `rotate(${selectedElement.rotation}deg)` : undefined,
                            zIndex: selectedElement ? selectedElement.zIndex ?? 0 : 1000,
                          }}
                        >
                          {selectedElement && !selectedElement.locked && (
                            <>
                              {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeHandle[]).map((handle) => (
                                <button
                                  key={handle}
                                  className={clsx('selection-handle', `handle-${handle}`)}
                                  onPointerDown={(event) => handleResizeHandlePointerDown(handle, event)}
                                />
                              ))}
                              <button className="rotation-handle" onPointerDown={handleRotatePointerDown} />
                            </>
                          )}
                        </div>
                        )}

                        {snapLines.map((line) => (
                        <div
                          key={`${line.orientation}-${line.value}`}
                          className={clsx('snap-line', line.orientation)}
                          style={
                            line.orientation === 'vertical'
                              ? { left: `${line.value * canvasScale}px` }
                              : { top: `${line.value * canvasScale}px` }
                          }
                        />
                        ))}

                        {marqueeBounds && (
                        <div
                          className="marquee-box"
                          style={{
                            left: `${marqueeBounds.left * canvasScale}px`,
                            top: `${marqueeBounds.top * canvasScale}px`,
                            width: `${marqueeBounds.width * canvasScale}px`,
                            height: `${marqueeBounds.height * canvasScale}px`,
                          }}
                        />
                        )}
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="empty-workspace">
                  <div className="empty-workspace-copy">
                    <h2>工作区为空</h2>
                    <p>先新建一个标签、导入 DDL，或从顶部模板库打开已有模板。</p>
                  </div>
                  <div className="empty-workspace-actions">
                    <button className="action-button" onClick={createFreshDocument}>
                      <FilePlus2 size={16} />
                      新建标签
                    </button>
                    <button className="ghost-button" onClick={() => ddlInputRef.current?.click()}>
                      <Upload size={16} />
                      导入 DDL
                    </button>
                    <button className="ghost-button" onClick={reopenLastClosedTab} disabled={recentClosedTabs.length === 0}>
                      <RotateCcw size={16} />
                      恢复关闭标签
                    </button>
                  </div>
                </div>
              )}
            </section>

            <aside className="inspector object-panel">
              {!hasActiveTab ? (
                <p className="empty-note">打开一个标签后，这里会显示对象属性和精确调整项。</p>
              ) : selectedElementIds.length === 0 ? (
                <p className="empty-note">可单选、框选、按住 Ctrl 多选，再拖拽、缩放、旋转或用键盘微调。</p>
              ) : selectedElement ? (
                <ElementInspector
                  element={selectedElement}
                  layerCount={labelDocument.elements.length}
                  onNameChange={(name) => updateElementName(selectedElement.id, name)}
                  onPatch={updateSelectedElement}
                  onBringForward={() => reorderSelected('forward')}
                  onSendBackward={() => reorderSelected('backward')}
                  onBringToFront={() => reorderSelected('front')}
                  onSendToBack={() => reorderSelected('back')}
                  onToggleLock={() => toggleLock(selectedElement.id)}
                  onToggleHidden={() => toggleHidden(selectedElement.id)}
                />
              ) : (
                <MultiSelectionInspector
                  count={selectedElementIds.length}
                  onBringForward={() => reorderSelected('forward')}
                  onSendBackward={() => reorderSelected('backward')}
                  onBringToFront={() => reorderSelected('front')}
                  onSendToBack={() => reorderSelected('back')}
                />
              )}
            </aside>
          </>
        )}
      </main>

      <ContentPicker
        open={contentPickerOpen}
        position={contentPickerPosition}
        element={selectedElement}
        groups={boundLexiconGroups}
        onPositionChange={setContentPickerPosition}
        onClose={() => setContentPickerOpen(false)}
        onApply={applySuggestionToSelectedElement}
      />

      <GroupBindingPanel
        open={groupBinderOpen}
        position={groupBinderPosition}
        selectedElements={bindableSelectedElements}
        groups={lexiconGroups}
        query={groupBinderQuery}
        onQueryChange={setGroupBinderQuery}
        onPositionChange={setGroupBinderPosition}
        onClose={() => setGroupBinderOpen(false)}
        onToggleGroup={toggleLexiconGroupForSelection}
        onDefaultGroupChange={setSelectedElementDefaultLexiconGroup}
        onRefresh={() => void refreshLexiconGroups()}
      />

      <input ref={ddlInputRef} type="file" accept=".ddl,.xml,text/xml" hidden onChange={handleDdlUpload} />

      {showDocumentDialog && hasActiveTab ? (
        <div className="modal-backdrop" onClick={() => setShowDocumentDialog(false)}>
          <section className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <span>文档与打印</span>
              <button className="inline-icon-button" onClick={() => setShowDocumentDialog(false)} aria-label="关闭文档与打印">
                ×
              </button>
            </div>
            <div className="modal-panel-body">
              <label>
                模板名称
                <input value={labelDocument.name} onChange={(event) => setDocumentField('name', event.target.value)} />
              </label>
              <label>
                模板说明
                <textarea value={templateDescription} onChange={(event) => setActiveTemplateMeta({ templateDescription: event.target.value })} placeholder="用于说明模板用途、内容或打印注意事项" />
              </label>
              <label>
                模板标签
                <input
                  value={templateTags.join(', ')}
                  onChange={(event) => setActiveTemplateMeta({ templateTags: parseTagInput(event.target.value) })}
                  placeholder="例如：发货, 40x30, 条码"
                />
              </label>
              <label>
                模板来源
                <input value={formatTemplateSource(templateSource)} disabled />
              </label>
              <div className="field-row">
                <label>
                  宽度 (mm)
                  <input type="number" min="20" step="1" value={labelDocument.widthMm} onChange={(event) => setDocumentField('widthMm', Number(event.target.value))} />
                </label>
                <label>
                  高度 (mm)
                  <input type="number" min="20" step="1" value={labelDocument.heightMm} onChange={(event) => setDocumentField('heightMm', Number(event.target.value))} />
                </label>
              </div>
              <div className="field-row">
                <label>
                  间隙 (mm)
                  <input type="number" min="0" step="0.5" value={labelDocument.gapMm} onChange={(event) => setDocumentField('gapMm', Number(event.target.value))} />
                </label>
                <label>
                  打印浓度
                  <input type="number" min="1" max="15" step="1" value={labelDocument.darkness} onChange={(event) => setDocumentField('darkness', Number(event.target.value))} />
                </label>
              </div>
              <label>
                打印份数
                <input type="number" min="1" max="99" value={labelDocument.copies} onChange={(event) => setDocumentField('copies', Number(event.target.value))} />
              </label>
              <label>
                打印机
                <select
                  value={labelDocument.printerDevicePath ?? appState?.printers[0]?.devicePath ?? ''}
                  onChange={(event) => setDocumentField('printerDevicePath', event.target.value)}
                  disabled={!appState?.printers.length}
                >
                  {appState?.printers.length ? (
                    appState.printers.map((printer) => (
                      <option key={printer.id} value={printer.devicePath}>
                        {printer.displayName}
                      </option>
                    ))
                  ) : (
                    <option value="">未发现打印机</option>
                  )}
                </select>
              </label>
              {currentPrinter ? (
                <div className={clsx('printer-status', currentPrinter.isAvailable ? 'online' : 'offline')}>
                  <span className="printer-status-dot" aria-hidden="true" />
                  <div>
                    <strong>{currentPrinter.displayName}</strong>
                    <span>{currentPrinter.statusMessage}</span>
                  </div>
                  <button className="inline-icon-button" type="button" onClick={() => void refreshPrinters()} disabled={refreshingPrinters} title="刷新打印机状态" aria-label="刷新打印机状态">
                    <RefreshCw size={14} className={refreshingPrinters ? 'is-spinning' : undefined} />
                  </button>
                </div>
              ) : null}
            </div>
            <div className="modal-actions">
              <button className="ghost-button compact-button" onClick={() => void saveCurrentTemplate()} disabled={saving}>
                <Save size={14} />
                {saving ? '保存中...' : activeTemplateId ? '保存' : '保存为模板'}
              </button>
              <button className="ghost-button compact-button" onClick={() => void saveAsTemplate()} disabled={saving}>
                <Save size={14} />
                另存为
              </button>
              <button className="print-button compact-button" onClick={printCurrent} disabled={printing || !currentPrinter?.isAvailable}>
                <Printer size={14} />
                {printing ? '打印中...' : '立即打印'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}

function ToolButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className="tool-button" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function LayerActionButton({ icon, label, disabled, onClick }: { icon: ReactNode; label: string; disabled: boolean; onClick: () => void }) {
  return (
    <button className="mini-button layer-action-button" type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  )
}

function LexiconManager({
  library,
  activeGroup,
  filteredEntries,
  query,
  onQueryChange,
  onSelectGroup,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onCreateEntry,
  onUpdateEntry,
  onDeleteEntry,
}: {
  library: LexiconLibrary
  activeGroup: LexiconGroup | null
  filteredEntries: LexiconEntry[]
  query: string
  onQueryChange: (query: string) => void
  onSelectGroup: (group: LexiconGroup) => void
  onCreateGroup: () => void
  onRenameGroup: (group: LexiconGroup) => void
  onDeleteGroup: (group: LexiconGroup) => void
  onCreateEntry: () => void
  onUpdateEntry: (entry: LexiconEntry, text: string) => void
  onDeleteEntry: (entry: LexiconEntry) => void
}) {
  const groups = library.lexicons.flatMap((lexicon) => lexicon.groups)
  const totalEntries = groups.reduce((sum, group) => sum + group.entries.length, 0)

  return (
    <section className="canvas-panel lexicon-workspace">
      <div className="panel-heading template-browser-head">
        <div>
          <span>词库</span>
          <p className="panel-note">管理可绑定到文本、条码和二维码对象的分组与条目。</p>
        </div>
        <div className="canvas-metrics lexicon-metrics">
          <div>
            <span>分组</span>
            <strong>{groups.length}</strong>
          </div>
          <div>
            <span>条目</span>
            <strong>{totalEntries}</strong>
          </div>
        </div>
      </div>

      <div className="lexicon-manager-grid">
        <section className="lexicon-column">
          <div className="lexicon-column-head">
            <strong>分组</strong>
            <button className="mini-button" type="button" onClick={onCreateGroup}>
              新增
            </button>
          </div>
          <div className="lexicon-list">
            {groups.length === 0 ? (
              <p className="empty-note">还没有分组。</p>
            ) : (
              groups.map((group) => (
                <button
                  key={group.id}
                  className={clsx('lexicon-list-item', activeGroup?.id === group.id && 'active')}
                  type="button"
                  onClick={() => onSelectGroup(group)}
                >
                  <strong>{group.name}</strong>
                  <span>{group.entries.length} 条</span>
                </button>
              ))
            )}
          </div>
          {activeGroup ? (
            <div className="lexicon-actions">
              <button className="mini-button" type="button" onClick={() => onRenameGroup(activeGroup)}>
                重命名
              </button>
              <button className="mini-button" type="button" onClick={() => onDeleteGroup(activeGroup)}>
                删除
              </button>
            </div>
          ) : null}
        </section>

        <section className="lexicon-column lexicon-entry-column">
          <div className="lexicon-column-head">
            <strong>{activeGroup ? `${activeGroup.name} 条目` : '条目'}</strong>
            <button className="mini-button" type="button" onClick={onCreateEntry} disabled={!activeGroup}>
              新增
            </button>
          </div>
          <label className="lexicon-search">
            搜索条目
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="按内容筛选" disabled={!activeGroup} />
          </label>
          <div className="lexicon-entry-list">
            {!activeGroup ? (
              <p className="empty-note">先选择一个分组。</p>
            ) : filteredEntries.length === 0 ? (
              <p className="empty-note">没有匹配的条目。</p>
            ) : (
              filteredEntries.map((entry) => (
                <LexiconEntryRow
                  key={entry.id}
                  entry={entry}
                  onUpdate={(text) => onUpdateEntry(entry, text)}
                  onDelete={() => onDeleteEntry(entry)}
                />
              ))
            )}
          </div>
        </section>
      </div>
    </section>
  )
}

function LexiconEntryRow({ entry, onUpdate, onDelete }: { entry: LexiconEntry; onUpdate: (text: string) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState(entry.text)

  useEffect(() => {
    setDraft(entry.text)
  }, [entry.text])

  return (
    <div className="lexicon-entry-row">
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onUpdate(draft)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur()
          }
          if (event.key === 'Escape') {
            setDraft(entry.text)
            event.currentTarget.blur()
          }
        }}
      />
      <button className="mini-button" type="button" onClick={onDelete}>
        删除
      </button>
    </div>
  )
}

const rotationPresets = [0, 90, 180, 270]
const barcodePresets = [
  { value: '128', label: 'Code 128' },
  { value: '39', label: 'Code 39' },
  { value: 'EAN13', label: 'EAN-13' },
  { value: 'EAN8', label: 'EAN-8' },
  { value: 'UPCA', label: 'UPC-A' },
  { value: 'UPCE', label: 'UPC-E' },
]

function InspectorSection({ title, hint, className, children }: { title?: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <section className={clsx('inspector-section', className)}>
      {title ? (
        <div className="inspector-section-head">
          <strong>{title}</strong>
          {hint ? <span>{hint}</span> : null}
        </div>
      ) : null}
      <div className="inspector-section-body">{children}</div>
    </section>
  )
}

function MultiSelectionInspector({
  count,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
}: {
  count: number
  onBringForward: () => void
  onSendBackward: () => void
  onBringToFront: () => void
  onSendToBack: () => void
}) {
  return (
    <div className="inspector-fields">
      <p className="empty-note">已选中 {count} 个元素。</p>
      <div className="field-row">
        <button className="mini-button" onClick={onBringToFront}>
          置顶
        </button>
        <button className="mini-button" onClick={onSendToBack}>
          置底
        </button>
      </div>
      <div className="field-row">
        <button className="mini-button" onClick={onBringForward}>
          上移
        </button>
        <button className="mini-button" onClick={onSendBackward}>
          下移
        </button>
      </div>
    </div>
  )
}

function ElementPreview({ element, canvasScale }: { element: LabelElement; canvasScale: number }) {
  if (element.type === 'text') {
    return <TextPreview element={element} canvasScale={canvasScale} />
  }

  if (element.type === 'barcode') {
    return <BarcodePreview element={element} canvasScale={canvasScale} />
  }

  if (element.type === 'qrcode') {
    return <QrPreview element={element} canvasScale={canvasScale} />
  }

  if (element.type === 'line') {
    return <div className="line-preview" style={{ height: Math.max(2, element.thickness * canvasScale * 0.2) }} />
  }

  if (element.type === 'rectangle') {
    return <div className="rectangle-preview" style={{ borderWidth: `${Math.max(1, element.thickness * canvasScale * 0.12)}px` }} />
  }

  return element.dataUrl ? <img className="image-preview" src={element.dataUrl} alt="" /> : <div className="image-placeholder">图片</div>
}

function TextPreview({ element, canvasScale }: { element: TextElement; canvasScale: number }) {
  const fontSizePx = Math.max(12, pointsToMm(element.fontSize) * canvasScale)
  const fontWeight = element.bold ? 700 : 500
  const fontFamily = '"Microsoft YaHei", "微软雅黑", sans-serif'
  const availableWidth = Math.max(1, element.width * canvasScale - 4)
  const measuredWidth = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) {
      return availableWidth
    }

    context.font = `${fontWeight} ${fontSizePx}px ${fontFamily}`
    return context.measureText(element.text || ' ').width
  }, [availableWidth, element.text, fontSizePx, fontFamily, fontWeight])
  const fitScale = clamp(availableWidth / Math.max(1, measuredWidth), 0.55, 1)
  const justifyContent = element.align === 'right' ? 'flex-end' : element.align === 'center' ? 'center' : 'flex-start'

  return (
    <div
      className="text-preview"
      style={{
        justifyContent,
      }}
    >
      <span
        className="text-preview-content"
        style={{
          fontSize: `${fontSizePx}px`,
          fontWeight,
          fontFamily,
          transform: `scaleX(${fitScale})`,
          transformOrigin: element.align === 'right' ? 'right top' : element.align === 'center' ? 'center top' : 'left top',
        }}
      >
        {element.text}
      </span>
    </div>
  )
}

function BarcodePreview({ element, canvasScale }: { element: BarcodeElement; canvasScale: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!canvasRef.current) {
      return
    }

    try {
      const canvasWidth = Math.max(80, Math.round(element.width * canvasScale))
      const canvasHeight = Math.max(48, Math.round(element.height * canvasScale))
      canvasRef.current.width = canvasWidth
      canvasRef.current.height = canvasHeight
      const estimatedModules = Math.max(40, element.value.length * 11 + 35)
      const showValue = element.showHumanReadable
      const valueHeight = showValue ? Math.max(16, canvasHeight * 0.22) : 0

      JsBarcode(canvasRef.current, element.value || ' ', {
        format: mapBarcodePreviewFormat(element.symbology),
        width: Math.max(1, Math.min(4, (canvasWidth * 0.92) / estimatedModules)),
        height: Math.max(18, canvasHeight - valueHeight),
        displayValue: showValue,
        textPosition: element.textPosition,
        margin: 0,
        background: '#ffffff',
        fontSize: Math.max(8, element.humanReadableFontSize * canvasScale * 0.3),
        textMargin: Math.max(2, canvasHeight * 0.02),
      })
    } catch {
      // Ignore preview errors for incomplete or unsupported content.
    }
  }, [canvasScale, element])

  return <canvas ref={canvasRef} className="barcode-preview" />
}

function QrPreview({ element, canvasScale }: { element: QrCodeElement; canvasScale: number }) {
  const [dataUrl, setDataUrl] = useState('')

  useEffect(() => {
    const textHeight = getQrTextAreaHeightMm(element)
    const coreSize = Math.max(minElementSizeMm, Math.min(element.width, element.height - textHeight))
    void QRCode.toDataURL(element.value || ' ', {
      margin: 0,
      width: Math.max(64, Math.round(coreSize * canvasScale)),
    }).then(setDataUrl)
  }, [canvasScale, element])

  return (
    <div className={clsx('qr-preview-wrap', element.showHumanReadable && `text-${element.textPosition}`)}>
      {element.showHumanReadable && element.textPosition === 'top' ? (
        <span style={{ fontSize: `${Math.max(8, element.humanReadableFontSize * canvasScale * 0.24)}px` }}>{element.value}</span>
      ) : null}
      <div className="qr-preview-box">
        <img className="qr-preview" src={dataUrl} alt="" />
      </div>
      {element.showHumanReadable && element.textPosition === 'bottom' ? (
        <span style={{ fontSize: `${Math.max(8, element.humanReadableFontSize * canvasScale * 0.24)}px` }}>{element.value}</span>
      ) : null}
    </div>
  )
}

function mapBarcodePreviewFormat(symbology: string) {
  const normalized = symbology.replace(/[_\s-]/g, '').toUpperCase()
  if (normalized === '128' || normalized === 'CODE128') {
    return 'CODE128'
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

  if (normalized === 'UPCA') {
    return 'UPC'
  }

  if (normalized === 'UPCE') {
    return 'UPC'
  }

  return 'CODE128'
}

function ElementInspector({
  element,
  layerCount,
  onNameChange,
  onPatch,
  onBringForward,
  onSendBackward,
  onBringToFront,
  onSendToBack,
  onToggleLock,
  onToggleHidden,
}: {
  element: LabelElement
  layerCount: number
  onNameChange: (name: string) => void
  onPatch: (patch: Partial<LabelElement>) => void
  onBringForward: () => void
  onSendBackward: () => void
  onBringToFront: () => void
  onSendToBack: () => void
  onToggleLock: () => void
  onToggleHidden: () => void
}) {
  const nudge = (x: number, y: number) => onPatch({ x: roundTo(element.x + x, 0.1), y: roundTo(element.y + y, 0.1) })
  const patchSize = (patch: Partial<LabelElement>) => {
    if (element.type !== 'qrcode') {
      onPatch(patch)
      return
    }

    const textHeight = getQrTextAreaHeightMm(element)
    if (typeof patch.width === 'number') {
      const size = patch.width
      onPatch({ ...patch, width: size, height: size + textHeight } as Partial<QrCodeElement>)
      return
    }

    if (typeof patch.height === 'number') {
      const size = Math.max(minElementSizeMm, patch.height - textHeight)
      onPatch({ ...patch, width: size, height: size + textHeight } as Partial<QrCodeElement>)
      return
    }

    onPatch(patch)
  }
  const patchQrTextVisibility = (showHumanReadable: boolean) => {
    if (element.type !== 'qrcode') {
      return
    }

    const textHeight = showHumanReadable ? getQrTextHeightMm(element.humanReadableFontSize) : 0
    onPatch({ showHumanReadable, height: element.width + textHeight } as Partial<QrCodeElement>)
  }
  const patchQrFontSize = (fontSize: number) => {
    if (element.type !== 'qrcode') {
      return
    }

    const textHeight = element.showHumanReadable ? getQrTextHeightMm(fontSize) : 0
    onPatch({ humanReadableFontSize: fontSize, height: element.width + textHeight } as Partial<QrCodeElement>)
  }

  return (
    <div className="inspector-fields">
      <InspectorSection className="overview-section">
        <label>
          名称
          <input value={element.name ?? ''} onChange={(event) => onNameChange(event.target.value)} />
        </label>
        <div className="field-row">
          <button className={clsx('mini-button', element.locked && 'active')} onClick={onToggleLock}>
            {element.locked ? '解锁' : '锁定'}
          </button>
          <button className={clsx('mini-button', element.hidden && 'active')} onClick={onToggleHidden}>
            {element.hidden ? '显示' : '隐藏'}
          </button>
        </div>
      </InspectorSection>

      <InspectorSection title="位置 / 尺寸" hint="mm">
        <div className="field-row">
          <label>
            X
            <input type="number" step="0.5" value={element.x} onChange={(event) => onPatch({ x: Number(event.target.value) })} />
          </label>
          <label>
            Y
            <input type="number" step="0.5" value={element.y} onChange={(event) => onPatch({ y: Number(event.target.value) })} />
          </label>
        </div>
        <div className="field-row">
          <label>
            宽
            <input type="number" step="0.5" value={element.width} onChange={(event) => patchSize({ width: Number(event.target.value) })} />
          </label>
          <label>
            高
            <input type="number" step="0.5" value={element.height} onChange={(event) => patchSize({ height: Number(event.target.value) })} />
          </label>
        </div>
        <div className="nudge-grid">
          <button className="mini-button" onClick={() => nudge(0, -0.5)}>
            ↑ 0.5
          </button>
          <button className="mini-button" onClick={() => nudge(-0.5, 0)}>
            ← 0.5
          </button>
          <button className="mini-button" onClick={() => nudge(0.5, 0)}>
            → 0.5
          </button>
          <button className="mini-button" onClick={() => nudge(0, 0.5)}>
            ↓ 0.5
          </button>
        </div>
      </InspectorSection>

      <InspectorSection>
        <label>
          旋转
          <input type="number" step="1" min="0" max="359" value={element.rotation} onChange={(event) => onPatch({ rotation: Number(event.target.value) })} />
        </label>
        <div className="segmented-row">
          {rotationPresets.map((preset) => (
            <button
              key={preset}
              type="button"
              className={clsx('mini-button', normalizeRotation(element.rotation) === preset && 'active')}
              onClick={() => onPatch({ rotation: preset })}
            >
              {preset}°
            </button>
          ))}
        </div>
        <div className="inspector-subhead">
          <span>层级</span>
          <strong>当前 {(element.zIndex ?? 0) + 1} / 共 {layerCount}</strong>
        </div>
        <div className="field-row">
          <button className="mini-button" onClick={onBringToFront}>
            置顶
          </button>
          <button className="mini-button" onClick={onSendToBack}>
            置底
          </button>
        </div>
        <div className="field-row">
          <button className="mini-button" onClick={onBringForward}>
            上移
          </button>
          <button className="mini-button" onClick={onSendBackward}>
            下移
          </button>
        </div>
      </InspectorSection>

      {element.type === 'text' && (
        <InspectorSection title="文本内容">
          <label>
            <span className="visually-hidden">内容</span>
            <ContentValueInput
              value={element.text}
              groupIds={element.lexiconGroupIds ?? []}
              onChange={(value) => onPatch({ text: value } as Partial<TextElement>)}
            />
          </label>
          <div className="field-row">
            <label>
              字号
              <input type="number" min="8" max="96" value={element.fontSize} onChange={(event) => onPatch({ fontSize: Number(event.target.value) } as Partial<TextElement>)} />
            </label>
            <div className="inline-field">
              <span>对齐</span>
              <div className="segmented-row">
                {[
                  { value: 'left', label: '左' },
                  { value: 'center', label: '中' },
                  { value: 'right', label: '右' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={clsx('mini-button', element.align === option.value && 'active')}
                    onClick={() => onPatch({ align: option.value as TextElement['align'] } as Partial<TextElement>)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <label className="toggle-row">
            <input type="checkbox" checked={element.bold} onChange={(event) => onPatch({ bold: event.target.checked } as Partial<TextElement>)} />
            粗体
          </label>
        </InspectorSection>
      )}

      {element.type === 'barcode' && (
        <InspectorSection title="条码内容">
          <label>
            <span className="visually-hidden">内容</span>
            <ContentValueInput
              value={element.value}
              groupIds={element.lexiconGroupIds ?? []}
              onChange={(value) => onPatch({ value } as Partial<BarcodeElement>)}
            />
          </label>
          <div className="field-row">
            <label>
              常用制式
              <select
                value={barcodePresets.some((item) => item.value === element.symbology) ? element.symbology : '__custom__'}
                onChange={(event) => onPatch({ symbology: event.target.value === '__custom__' ? element.symbology : event.target.value } as Partial<BarcodeElement>)}
              >
                {barcodePresets.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
                <option value="__custom__">自定义</option>
              </select>
            </label>
            <label>
              实际制式
              <input value={element.symbology} onChange={(event) => onPatch({ symbology: event.target.value } as Partial<BarcodeElement>)} />
            </label>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={element.showHumanReadable}
              onChange={(event) => onPatch({ showHumanReadable: event.target.checked } as Partial<BarcodeElement>)}
            />
            显示条码文字
          </label>
          <div className="field-row">
            <label>
              文字位置
              <select value={element.textPosition} onChange={(event) => onPatch({ textPosition: event.target.value as BarcodeElement['textPosition'] } as Partial<BarcodeElement>)}>
                <option value="bottom">下方</option>
                <option value="top">上方</option>
              </select>
            </label>
            <label>
              文字字号
              <input type="number" min="8" max="36" value={element.humanReadableFontSize} onChange={(event) => onPatch({ humanReadableFontSize: Number(event.target.value) } as Partial<BarcodeElement>)} />
            </label>
          </div>
        </InspectorSection>
      )}

      {element.type === 'qrcode' && (
        <InspectorSection title="二维码内容">
          <label>
            <span className="visually-hidden">内容</span>
            <ContentValueInput
              value={element.value}
              groupIds={element.lexiconGroupIds ?? []}
              onChange={(value) => onPatch({ value } as Partial<QrCodeElement>)}
            />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={element.showHumanReadable}
              onChange={(event) => patchQrTextVisibility(event.target.checked)}
            />
            同时显示文本
          </label>
          <div className="field-row">
            <label>
              文字位置
              <select value={element.textPosition} onChange={(event) => onPatch({ textPosition: event.target.value as QrCodeElement['textPosition'] } as Partial<QrCodeElement>)}>
                <option value="bottom">下方</option>
                <option value="top">上方</option>
              </select>
            </label>
            <label>
              文字字号
              <input type="number" min="8" max="36" value={element.humanReadableFontSize} onChange={(event) => patchQrFontSize(Number(event.target.value))} />
            </label>
          </div>
        </InspectorSection>
      )}

      {element.type === 'rectangle' && (
        <InspectorSection title="矩形样式">
          <label>
            边框粗细
            <input type="number" min="1" max="8" value={element.thickness} onChange={(event) => onPatch({ thickness: Number(event.target.value) } as Partial<RectangleElement>)} />
          </label>
        </InspectorSection>
      )}

      {element.type === 'line' && (
        <InspectorSection title="线条样式">
          <label>
            线条粗细
            <input type="number" min="1" max="8" value={element.thickness} onChange={(event) => onPatch({ thickness: Number(event.target.value) } as Partial<LineElement>)} />
          </label>
        </InspectorSection>
      )}

      {element.type === 'image' && (
        <InspectorSection title="图片设置">
          <label className="toggle-row">
            <input type="checkbox" checked={element.invert} onChange={(event) => onPatch({ invert: event.target.checked } as Partial<ImageElement>)} />
            打印时反相
          </label>
        </InspectorSection>
      )}
    </div>
  )
}

function ContentValueInput({ value, groupIds, onChange }: { value: string; groupIds: string[]; onChange: (value: string) => void }) {
  const [suggestions, setSuggestions] = useState<LexiconSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const groupKey = groupIds.join(',')

  useEffect(() => {
    if (groupIds.length === 0) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetchJson<LexiconSuggestion[]>(`/api/lexicon-suggestions?groups=${encodeURIComponent(groupKey)}&q=${encodeURIComponent(value)}`, controller.signal)
        .then((items) => {
          setSuggestions(items)
          setActiveIndex(0)
        })
        .catch(() => undefined)
    }, 120)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [groupIds.length, groupKey, value])

  function commitSuggestion(index: number) {
    const suggestion = suggestions[index]
    if (!suggestion) {
      return
    }

    onChange(suggestion.text)
    setOpen(false)
  }

  return (
    <div className="content-input-wrap">
      <textarea
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (!open || suggestions.length === 0) {
            return
          }

          if (event.key === 'ArrowDown') {
            event.preventDefault()
            setActiveIndex((current) => (current + 1) % suggestions.length)
          } else if (event.key === 'ArrowUp') {
            event.preventDefault()
            setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length)
          } else if (event.key === 'Enter') {
            event.preventDefault()
            commitSuggestion(activeIndex)
          } else if (event.key === 'Escape') {
            setOpen(false)
          }
        }}
      />
      {open && suggestions.length > 0 ? (
        <div className="autocomplete-popover">
          {suggestions.slice(0, 8).map((suggestion, index) => (
            <button
              key={`${suggestion.groupId}-${suggestion.entryId}`}
              type="button"
              className={clsx('suggestion-row', index === activeIndex && 'active')}
              onMouseDown={(event) => {
                event.preventDefault()
                commitSuggestion(index)
              }}
            >
              <span>{suggestion.text}</span>
              <small>{suggestion.groupName}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function GroupBindingPanel({
  open,
  position,
  selectedElements,
  groups,
  query,
  onQueryChange,
  onPositionChange,
  onClose,
  onToggleGroup,
  onDefaultGroupChange,
  onRefresh,
}: {
  open: boolean
  position: Point
  selectedElements: Array<TextElement | BarcodeElement | QrCodeElement>
  groups: LexiconGroupSummary[]
  query: string
  onQueryChange: (query: string) => void
  onPositionChange: (position: Point) => void
  onClose: () => void
  onToggleGroup: (groupId: string) => void
  onDefaultGroupChange: (groupId: string | null) => void
  onRefresh: () => void
}) {
  const filteredGroups = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) {
      return groups
    }

    return groups.filter((group) =>
      group.name.toLowerCase().includes(term)
      || group.lexiconName.toLowerCase().includes(term),
    )
  }, [groups, query])
  const selectedCount = selectedElements.length
  const singleElement = selectedElements.length === 1 ? selectedElements[0] : null
  const boundGroupIds = new Set(singleElement?.lexiconGroupIds ?? [])

  if (!open) {
    return null
  }

  return (
    <section className="group-binding-panel" style={{ left: position.x, top: position.y }}>
      <div
        className="group-binding-head"
        onPointerDown={(event) => {
          const startX = event.clientX - position.x
          const startY = event.clientY - position.y
          event.currentTarget.setPointerCapture(event.pointerId)
          const handleMove = (moveEvent: PointerEvent) => {
            onPositionChange({
              x: clamp(moveEvent.clientX - startX, 8, window.innerWidth - 360),
              y: clamp(moveEvent.clientY - startY, 8, window.innerHeight - 220),
            })
          }
          const handleUp = () => {
            window.removeEventListener('pointermove', handleMove)
            window.removeEventListener('pointerup', handleUp)
          }
          window.addEventListener('pointermove', handleMove)
          window.addEventListener('pointerup', handleUp)
        }}
      >
        <div>
          <strong>分组绑定</strong>
          <span>{selectedCount === 0 ? '未选择可绑定对象' : selectedCount === 1 ? `${singleElement?.name ?? getDefaultElementName(singleElement?.type ?? 'text')}` : `批量绑定 ${selectedCount} 个对象`}</span>
        </div>
        <button className="inline-icon-button" type="button" onClick={onClose} aria-label="关闭分组绑定">
          ×
        </button>
      </div>

      <div className="group-binding-tools">
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="搜索分组" />
        <button className="mini-button" type="button" onClick={onRefresh}>
          刷新
        </button>
      </div>

      {singleElement ? (
        <label className="group-binding-default">
          默认分组
          <select
            value={singleElement.defaultLexiconGroupId ?? ''}
            onChange={(event) => onDefaultGroupChange(event.target.value || null)}
            disabled={(singleElement.lexiconGroupIds ?? []).length === 0}
          >
            <option value="">不指定</option>
            {groups
              .filter((group) => boundGroupIds.has(group.id))
              .map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
          </select>
        </label>
      ) : (
        <p className="empty-note">多选时可批量勾选分组；默认分组请单选对象后设置。</p>
      )}

      <div className="group-binding-list">
        {selectedCount === 0 ? (
          <p className="empty-note">请选择文本、条码或二维码对象。</p>
        ) : filteredGroups.length === 0 ? (
          <p className="empty-note">没有匹配的分组。</p>
        ) : (
          filteredGroups.map((group) => {
            const boundCount = selectedElements.filter((element) => (element.lexiconGroupIds ?? []).includes(group.id)).length
            const checked = selectedCount > 0 && boundCount === selectedCount
            const partial = boundCount > 0 && boundCount < selectedCount
            return (
              <label key={group.id} className={clsx('group-binding-row', partial && 'partial')}>
                <input type="checkbox" checked={checked} onChange={() => onToggleGroup(group.id)} />
                <span>
                  <strong>{group.name}</strong>
                  <small>
                    {group.entryCount} 条
                    {partial ? ` · ${boundCount}/${selectedCount}` : ''}
                  </small>
                </span>
              </label>
            )
          })
        )}
      </div>
    </section>
  )
}

function ContentPicker({
  open,
  position,
  element,
  groups,
  onPositionChange,
  onClose,
  onApply,
}: {
  open: boolean
  position: Point
  element: LabelElement | null
  groups: LexiconGroupSummary[]
  onPositionChange: (position: Point) => void
  onClose: () => void
  onApply: (text: string) => void
}) {
  const [suggestions, setSuggestions] = useState<LexiconSuggestion[]>([])
  const [query, setQuery] = useState('')
  const groupIds = isLexiconEnabledElement(element) ? element.lexiconGroupIds ?? [] : []
  const groupKey = groupIds.join(',')

  useEffect(() => {
    if (!open || groupIds.length === 0) {
      setSuggestions([])
      return
    }

    const controller = new AbortController()
    fetchJson<LexiconSuggestion[]>(`/api/lexicon-suggestions?groups=${encodeURIComponent(groupKey)}&q=${encodeURIComponent(query)}`, controller.signal)
      .then(setSuggestions)
      .catch(() => undefined)
    return () => controller.abort()
  }, [open, groupIds.length, groupKey, query])

  if (!open) {
    return null
  }

  return (
    <section className="content-picker" style={{ left: position.x, top: position.y }}>
      <div
        className="content-picker-head"
        onPointerDown={(event) => {
          const startX = event.clientX - position.x
          const startY = event.clientY - position.y
          event.currentTarget.setPointerCapture(event.pointerId)
          const handleMove = (moveEvent: PointerEvent) => {
            onPositionChange({
              x: clamp(moveEvent.clientX - startX, 8, window.innerWidth - 320),
              y: clamp(moveEvent.clientY - startY, 8, window.innerHeight - 180),
            })
          }
          const handleUp = () => {
            window.removeEventListener('pointermove', handleMove)
            window.removeEventListener('pointerup', handleUp)
          }
          window.addEventListener('pointermove', handleMove)
          window.addEventListener('pointerup', handleUp)
        }}
      >
        <strong>内容候选</strong>
        <button className="inline-icon-button" type="button" onClick={onClose} aria-label="关闭内容浮窗">
          ×
        </button>
      </div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选候选" />
      {groups.length === 0 ? (
        <p className="empty-note">当前对象未绑定分组。</p>
      ) : suggestions.length === 0 ? (
        <p className="empty-note">没有匹配的内容。</p>
      ) : (
        <div className="content-picker-list">
          {suggestions.map((suggestion) => (
            <button
              key={`${suggestion.groupId}-${suggestion.entryId}`}
              type="button"
              onClick={() => onApply(suggestion.text)}
              onDoubleClick={() => {
                onApply(suggestion.text)
                onClose()
              }}
            >
              <span>{suggestion.text}</span>
              <small>{suggestion.groupName}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new Error(await getResponseError(response))
  }

  return (await response.json()) as T
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await getResponseError(response))
  }

  return (await response.json()) as T
}

async function putJson<T>(url: string, payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await getResponseError(response))
  }

  return (await response.json()) as T
}

async function patchJson<TResponse, TPayload>(url: string, payload: TPayload): Promise<TResponse> {
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    throw new Error(await getResponseError(response))
  }

  return (await response.json()) as TResponse
}

async function deleteJson(url: string): Promise<void> {
  const response = await fetch(url, {
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(await getResponseError(response))
  }
}

async function getResponseError(response: Response) {
  const text = await response.text()

  try {
    const parsed = JSON.parse(text) as { error?: string }
    if (parsed.error) {
      return parsed.error
    }
  } catch {
    // Keep plain text below.
  }

  return text || '发生未知错误'
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '发生未知错误'
}

type DlabelImportResult = {
  document: LabelDocument
  warnings: string[]
}

function importDlabelTemplate(source: string, fileName: string): DlabelImportResult {
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

  const paperLayout = readDlabelPaperLayout(paper)
  const widthMm = paperLayout.widthMm
  const heightMm = paperLayout.heightMm
  const baseName = fileName.replace(/\.[^.]+$/, '').trim() || '导入标签'
  const warnings: string[] = []
  let unsupportedCount = 0

  const elements = Array.from(documentNode.querySelectorAll('labelobjects > drawobj'))
    .sort((left, right) => readDlabelNumber(left, 'zvalue', 0) - readDlabelNumber(right, 'zvalue', 0))
    .map((node, index) => parseDlabelObject(node, index, paperLayout))
    .flatMap((result) => {
      if (!result) {
        unsupportedCount += 1
        return []
      }

      return [result]
    })

  if (unsupportedCount > 0) {
    warnings.push(`跳过 ${unsupportedCount} 个暂不支持的对象`)
  }

  const importedElements = elements.length > 0 ? elements : [createElement('text', createBlankDocument(baseName), { text: '空白导入模板' })]
  if (elements.length === 0) {
    warnings.push('未识别到可导入对象，已创建空白标签')
  }

  return {
    document: normalizeDocument({
      name: baseName,
      widthMm,
      heightMm,
      copies: 1,
      darkness: 8,
      gapMm: 2,
      elements: importedElements,
    }),
    warnings,
  }
}

function sanitizeDlabelXml(source: string) {
  return source.replace(/\s+previewimage="[\s\S]*?"(?=\s*>)/, '')
}

function readDlabelPaperLayout(node: Element): DlabelPaperLayout {
  const sourceWidthMm = Math.max(minDocumentSizeMm, readDlabelNumber(node, 'w', 40))
  const sourceHeightMm = Math.max(minDocumentSizeMm, readDlabelNumber(node, 'h', 30))
  const rotation = normalizeRotation(readDlabelNumber(node, 'rotate', 0))

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
) {
  if (paperLayout.rotation === 90) {
    return {
      x: paperLayout.sourceHeightMm - y,
      y: x,
      width,
      height,
      rotation: normalizeRotation(rotation + 90),
    }
  }

  if (paperLayout.rotation === 180) {
    return {
      x: paperLayout.sourceWidthMm - x - width,
      y: paperLayout.sourceHeightMm - y - height,
      width,
      height,
      rotation: normalizeRotation(rotation + 180),
    }
  }

  if (paperLayout.rotation === 270) {
    return {
      x: y,
      y: paperLayout.sourceWidthMm - x - width,
      width,
      height,
      rotation: normalizeRotation(rotation + 270),
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

function parseDlabelObject(node: Element, index: number, paperLayout: DlabelPaperLayout): LabelElement | null {
  const itemType = node.getAttribute('itemtype') ?? ''
  const rawX = readDlabelNumber(node, 'l', 0)
  const rawY = readDlabelNumber(node, 't', 0)
  const rawWidth = Math.max(minElementSizeMm, readDlabelNumber(node, 'w', 10))
  const rawHeight = Math.max(minElementSizeMm, readDlabelNumber(node, 'h', 5))
  const rawRotation = normalizeRotation(readDlabelNumber(node, 'rotate', 0))
  const transformed = transformDlabelRect(rawX, rawY, rawWidth, rawHeight, rawRotation, paperLayout)
  const x = clamp(transformed.x, 0, paperLayout.widthMm)
  const y = clamp(transformed.y, 0, paperLayout.heightMm)
  const width = clamp(transformed.width, minElementSizeMm, paperLayout.widthMm)
  const height = clamp(transformed.height, minElementSizeMm, paperLayout.heightMm)
  const rotation = transformed.rotation

  if (itemType === '5') {
    const textNode = node.querySelector('textlist > text')
    return {
      id: createId(),
      type: 'text',
      name: 'DDL 文本',
      x,
      y,
      width,
      height,
      rotation,
      zIndex: index,
      text: textNode?.getAttribute('value') ?? '',
      fontSize: clamp(Math.round(readDlabelNumber(node, 'fontsize', 18)), 8, 96),
      bold: (node.getAttribute('fontbold') ?? '').toLowerCase() === 'true',
      align: mapDlabelTextAlign(node.getAttribute('alignment')),
    } satisfies TextElement
  }

  if (itemType === '7') {
    const textNode = node.querySelector('textlist > text')
    const value = textNode?.getAttribute('value') ?? ''
    const barcodeType = (node.getAttribute('barcodetype') ?? '').trim()
    if (/qr/i.test(barcodeType)) {
      const size = clamp(Math.max(width, height), minElementSizeMm, Math.min(paperLayout.widthMm, paperLayout.heightMm))
      return {
        id: createId(),
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
      } satisfies QrCodeElement
    }

    return {
      id: createId(),
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
    } satisfies BarcodeElement
  }

  if (itemType === '1') {
    return parseDlabelLine(node, index, paperLayout)
  }

  if (itemType === '2' || itemType === '3') {
    const thickness = Math.max(1, Math.round(readDlabelNumber(node, 'linewidth', readDlabelNumber(node, 'thickness', 1))))
    return {
      id: createId(),
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
        id: createId(),
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
      id: createId(),
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

function parseDlabelLine(node: Element, index: number, paperLayout: DlabelPaperLayout): LineElement {
  const lineWidth = Math.max(1, Math.round(readDlabelNumber(node, 'linewidth', readDlabelNumber(node, 'thickness', 1))))
  const degree = normalizeRotation(readDlabelNumber(node, 'linedegree', readDlabelNumber(node, 'rotate', 0)) + paperLayout.rotation)
  const startX = readDlabelNumber(node, 'linestartx', readDlabelNumber(node, 'l', 0))
  const startY = readDlabelNumber(node, 'linestarty', readDlabelNumber(node, 't', 0))
  const lineLength = Math.max(minElementSizeMm, readDlabelNumber(node, 'linelength', Math.max(readDlabelNumber(node, 'w', 1), readDlabelNumber(node, 'h', 1))))
  const transformedStart = transformDlabelPoint(startX, startY, paperLayout)
  const lineVisualThickness = Math.max(minElementSizeMm, readDlabelNumber(node, 'w', readDlabelNumber(node, 'h', 1.2)))
  const horizontalDelta = degree === 180 ? -lineLength : lineLength
  const verticalDelta = degree === 270 ? -lineLength : lineLength

  if (degree === 90 || degree === 270) {
    return {
      id: createId(),
      type: 'line',
      name: 'DDL 竖线',
      x: clamp(transformedStart.x - lineVisualThickness / 2, 0, paperLayout.widthMm),
      y: clamp(Math.min(transformedStart.y, transformedStart.y + verticalDelta), 0, paperLayout.heightMm),
      width: clamp(lineVisualThickness, minElementSizeMm, paperLayout.widthMm),
      height: clamp(lineLength, minElementSizeMm, paperLayout.heightMm),
      rotation: 0,
      zIndex: index,
      thickness: lineWidth,
    }
  }

  return {
    id: createId(),
    type: 'line',
    name: 'DDL 横线',
    x: clamp(Math.min(transformedStart.x, transformedStart.x + horizontalDelta), 0, paperLayout.widthMm),
    y: clamp(transformedStart.y - lineVisualThickness / 2, 0, paperLayout.heightMm),
    width: clamp(lineLength, minElementSizeMm, paperLayout.widthMm),
    height: clamp(lineVisualThickness, minElementSizeMm, paperLayout.heightMm),
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
