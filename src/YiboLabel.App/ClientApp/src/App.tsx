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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import clsx from 'clsx'
import './App.css'
import './styles/floating-panels.css'
import { fetchAppState, fetchPrinters } from './api/appStateApi'
import {
  createLexiconEntry as createLexiconEntryRequest,
  createLexiconGroup as createLexiconGroupRequest,
  deleteLexiconEntry as deleteLexiconEntryRequest,
  deleteLexiconGroup as deleteLexiconGroupRequest,
  fetchLexiconGroups,
  fetchLexiconLibrary,
  renameLexiconGroup as renameLexiconGroupRequest,
  updateLexiconEntry as updateLexiconEntryRequest,
} from './api/lexiconsApi'
import { printDocument } from './api/printApi'
import {
  createTemplate,
  deleteTemplate as deleteTemplateRequest,
  duplicateTemplate as duplicateTemplateRequest,
  fetchTemplate,
  fetchTemplates,
  updateTemplate,
  updateTemplateMeta,
} from './api/templatesApi'
import { getErrorMessage } from './api/http'
import { ContentPicker } from './components/ContentPicker'
import {
  ElementInspector,
  ElementPreview,
  LayerActionButton,
  MultiSelectionInspector,
  ToolButton,
} from './components/ElementInspector'
import { GroupBindingPanel } from './components/GroupBindingPanel'
import { LexiconManager } from './components/LexiconManager'
import {
  createEditorTab,
  isTabDirty,
  normalizeEditorTab,
  recentClosedTabLimit,
  serializeTabSnapshot,
} from './domain/editorTabs'
import {
  boundsIntersect,
  createRulerTicks,
  findBestSnap,
  getElementBounds,
  getElementsAtPoint,
  getMarqueeBounds,
  getSelectionBounds,
  getSnapTargets,
  pointFromPointer,
  reorderElements,
  snapMoveBounds,
  type Point,
  type SnapLine,
} from './domain/editorGeometry'
import { importDlabelTemplate } from './domain/dlabelImport'
import {
  clamp,
  createBlankDocument,
  createContentPatch,
  createElement,
  createId,
  getDefaultElementName,
  getLayerMeta,
  getQrTextAreaHeightMm,
  isLexiconEnabledElement,
  minDocumentSizeMm,
  minElementSizeMm,
  normalizeDocument,
  normalizeElement,
  normalizeRotation,
  parseSerializedDocument,
  reindexElements,
  roundTo,
  serializeDocument,
  sortElements,
} from './domain/labelDocument'
import {
  applyTemplateMetaPatch,
  formatTemplateSource,
  getLayerPositionLabel,
  parseTagInput,
  toTemplateSummary,
} from './domain/templateMetadata'
import {
  getTabDisplayName,
  historyLimit,
  readWorkspaceSnapshot,
  workspaceStorageKey,
  type ClosedTabSnapshot,
  type EditorTab,
  type WorkspaceSnapshot,
} from './domain/workspace'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { sendWindowChromeCommand } from './platform/windowChrome'
import type {
  AppStateResponse,
  DuplicateTemplateRequest,
  ImageElement,
  LabelDocument,
  LabelElement,
  LabelTemplateRecord,
  LexiconEntry,
  LexiconGroup,
  LexiconLibrary,
  LabelTemplateSummary,
  LexiconGroupSummary,
  UpdateTemplateMetaRequest,
} from './types'

const baseCanvasScale = 16
const emptySelectionIds: string[] = []
const emptyHistoryState: EditorTab['history'] = { past: [], future: [] }
const emptyTemplateTags: string[] = []

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type TemplateSort = 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'created-desc' | 'created-asc'

type WorkspaceSurface = 'editor' | 'templates' | 'lexicons'
type LayerAction = 'front' | 'back' | 'forward' | 'backward'

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
  const selectedElementIds = activeTab?.selectedElementIds ?? emptySelectionIds
  const history = activeTab?.history ?? emptyHistoryState
  const activeTemplateId = activeTab?.templateId ?? null
  const templateDescription = activeTab?.templateDescription ?? ''
  const templateTags = activeTab?.templateTags ?? emptyTemplateTags
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

  const updateActiveTab = useCallback((mutator: (tab: EditorTab) => EditorTab) => {
    if (!activeTabId) {
      return
    }

    setTabs((currentTabs) => currentTabs.map((tab) => (tab.id === activeTabId ? mutator(tab) : tab)))
  }, [activeTabId])

  const setActiveDocument = useCallback((nextDocument: LabelDocument, options?: { pushHistory?: boolean }) => {
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
  }, [updateActiveTab])

  const setActiveSelection = useCallback((nextSelection: string[]) => {
    updateActiveTab((tab) => ({
      ...tab,
      selectedElementIds: nextSelection.filter((id) => tab.document.elements.some((element) => element.id === id)),
    }))
  }, [updateActiveTab])

  const pushHistoryFrom = useCallback((startDocument: LabelDocument) => {
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
  }, [updateActiveTab])

  const applyDocument = useCallback((nextDocument: LabelDocument, options?: { pushHistory?: boolean }) => {
    setActiveDocument(nextDocument, options)
  }, [setActiveDocument])

  const updateDocument = useCallback((mutator: (current: LabelDocument) => LabelDocument, options?: { pushHistory?: boolean }) => {
    applyDocument(mutator(documentRef.current), options)
  }, [applyDocument])

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
    updateActiveTab((tab) => applyTemplateMetaPatch(tab, patch))
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
  }, [labelDocument.elements, selectedElementIds, setActiveSelection])

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
  }, [canvasScale, interaction, pushHistoryFrom, setActiveDocument, setActiveSelection, visibleElements])

  useKeyboardShortcuts({
    activeTabId,
    visibleElements,
    undo,
    redo,
    setActiveSelection,
    duplicateSelectedElements,
    saveCurrentTemplate,
    closeTab,
    reorderSelected,
    reopenLastClosedTab,
    deleteSelectedElements,
    nudgeSelection,
  })

  async function bootstrap() {
    try {
      const [stateResponse, templatesResponse, lexiconGroupsResponse, lexiconLibraryResponse] = await Promise.all([
        fetchAppState(),
        fetchTemplates(),
        fetchLexiconGroups(),
        fetchLexiconLibrary(),
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
        const template = await fetchTemplate(templatesResponse[0].id)
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
    setTemplates(await fetchTemplates())
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
      fetchLexiconGroups(),
      fetchLexiconLibrary(),
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
      const created = await createLexiconGroupRequest(activeLexicon.id, name)
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
      const saved = await renameLexiconGroupRequest(activeLexicon.id, group.id, name)
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
      await deleteLexiconGroupRequest(activeLexicon.id, group.id)
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
      await createLexiconEntryRequest(activeLexicon.id, activeLexiconGroup.id, text)
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
      await updateLexiconEntryRequest(activeLexicon.id, activeLexiconGroup.id, entry.id, text.trim())
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
      await deleteLexiconEntryRequest(activeLexicon.id, activeLexiconGroup.id, entry.id)
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

  async function loadTemplate(id: string) {
    const template = await fetchTemplate(id)
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
      const saved = await updateTemplate(activeTemplateId, {
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
      const saved = await createTemplate({
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
      const saved = await updateTemplateMeta(template.id, {
        name: nextName,
        description: template.description,
        tags: template.tags,
      } satisfies UpdateTemplateMetaRequest)

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
      const duplicated = await duplicateTemplateRequest(template.id, {
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
      await deleteTemplateRequest(template.id)
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
      const response = await printDocument({
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
      const printers = await fetchPrinters()
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
      const imported = importDlabelTemplate(ddlSource, file.name, {
        minDocumentSizeMm,
        minElementSizeMm,
        createBlankDocument,
        createElement,
        normalizeDocument,
        normalizeRotation,
        clamp,
        createId,
      })
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
