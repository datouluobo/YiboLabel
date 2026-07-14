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
import { DocumentPrintDialog } from './components/DocumentPrintDialog'
import { EditorCanvasPanel } from './components/EditorCanvasPanel'
import { EditorSidebar } from './components/EditorSidebar'
import { EditorTabStrip } from './components/EditorTabStrip'
import { ElementInspector, MultiSelectionInspector } from './components/ElementInspector'
import { GroupBindingPanel } from './components/GroupBindingPanel'
import { LexiconManager } from './components/LexiconManager'
import { TemplateLibraryView } from './components/TemplateLibraryView'
import { WorkspaceTopbar } from './components/WorkspaceTopbar'
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
      <WorkspaceTopbar
        activeSurface={activeSurface}
        showDocumentDialog={showDocumentDialog}
        hasActiveTab={hasActiveTab}
        history={history}
        recentClosedTabsCount={recentClosedTabs.length}
        appState={appState}
        printerDevicePath={labelDocument.printerDevicePath ?? appState?.printers[0]?.devicePath ?? ''}
        currentPrinter={currentPrinter}
        refreshingPrinters={refreshingPrinters}
        saving={saving}
        printing={printing}
        activeTemplateId={activeTemplateId}
        onToggleSurface={toggleSurface}
        onShowDocumentDialog={() => setShowDocumentDialog(true)}
        onUndo={undo}
        onRedo={redo}
        onImportDdl={() => ddlInputRef.current?.click()}
        onReopenLastClosedTab={reopenLastClosedTab}
        onPrinterChange={(devicePath) => setDocumentField('printerDevicePath', devicePath)}
        onRefreshPrinters={() => void refreshPrinters()}
        onSaveCurrentTemplate={() => void saveCurrentTemplate()}
        onSaveAsTemplate={() => void saveAsTemplate()}
        onPrintCurrent={printCurrent}
      />

      <EditorTabStrip
        tabs={tabs}
        activeSurface={activeSurface}
        activeTabId={activeTabId}
        isTabDirty={isTabDirty}
        onShowEditor={showEditor}
        onCloseTab={closeTab}
        onCreateFreshDocument={createFreshDocument}
      />

      <main className={clsx('workspace', activeSurface !== 'editor' && 'library-mode')}>
        {activeSurface === 'templates' ? (
          <TemplateLibraryView
            templates={templates}
            visibleTemplates={visibleTemplates}
            templateQuery={templateQuery}
            templateSort={templateSort}
            openedTemplateState={openedTemplateState}
            onTemplateQueryChange={setTemplateQuery}
            onTemplateSortChange={setTemplateSort}
            onCreateDocument={createFreshDocument}
            onImportDdl={() => ddlInputRef.current?.click()}
            onOpenTemplate={(templateId) => {
              void loadTemplate(templateId)
              setActiveSurface('editor')
            }}
            onDuplicateTemplate={(template) => void duplicateTemplate(template)}
            onRenameTemplate={(template) => void renameTemplate(template)}
            onDeleteTemplate={(template) => void deleteTemplate(template)}
          />
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
            <EditorSidebar
              hasActiveTab={hasActiveTab}
              elementCount={labelDocument.elements.length}
              layersCollapsed={layersCollapsed}
              selectedElementIds={selectedElementIds}
              sortedElements={sortedElements}
              onAddText={() => addNewElement('text')}
              onAddBarcode={() => addNewElement('barcode')}
              onAddQrCode={() => addNewElement('qrcode')}
              onAddLine={() => addNewElement('line')}
              onAddRectangle={() => addNewElement('rectangle')}
              onAddImage={() => fileInputRef.current?.click()}
              onToggleLayersCollapsed={() => setLayersCollapsed((current) => !current)}
              onReorderFront={() => reorderSelected('front')}
              onReorderForward={() => reorderSelected('forward')}
              onReorderBackward={() => reorderSelected('backward')}
              onReorderBack={() => reorderSelected('back')}
              onSelectLayer={(elementId, additive) => {
                if (!additive) {
                  setActiveSelection([elementId])
                  return
                }

                setActiveSelection(
                  selectedElementIds.includes(elementId)
                    ? selectedElementIds.filter((id) => id !== elementId)
                    : [...selectedElementIds, elementId],
                )
              }}
              onToggleHidden={toggleHidden}
              onToggleLock={toggleLock}
            />

            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageUpload} />

            <EditorCanvasPanel
              hasActiveTab={hasActiveTab}
              labelDocument={labelDocument}
              selectedElementIds={selectedElementIds}
              visibleElementsCount={visibleElements.length}
              bindableSelectedCount={bindableSelectedElements.length}
              contentPickerOpen={contentPickerOpen}
              groupBinderOpen={groupBinderOpen}
              canvasScale={canvasScale}
              horizontalRulerTicks={horizontalRulerTicks}
              verticalRulerTicks={verticalRulerTicks}
              canvasWrapRef={canvasWrapRef}
              canvasRef={canvasRef}
              resolvedVisibleElements={resolvedVisibleElements}
              selectedElement={selectedElement}
              selectionBounds={selectionBounds}
              snapLines={snapLines}
              marqueeBounds={marqueeBounds}
              recentClosedTabsCount={recentClosedTabs.length}
              onToggleGroupBinder={() => setGroupBinderOpen((open) => !open)}
              onToggleContentPicker={() => setContentPickerOpen((open) => !open)}
              onDuplicateSelected={duplicateSelectedElements}
              onDeleteSelected={deleteSelectedElements}
              onCanvasWrapPointerDown={handleCanvasWrapPointerDown}
              onCanvasWheel={handleCanvasWheel}
              onCanvasPointerDown={handleCanvasPointerDown}
              onElementPointerDown={handleElementPointerDown}
              onResizeHandlePointerDown={handleResizeHandlePointerDown}
              onRotatePointerDown={handleRotatePointerDown}
              onCreateFreshDocument={createFreshDocument}
              onImportDdl={() => ddlInputRef.current?.click()}
              onReopenLastClosedTab={reopenLastClosedTab}
            />

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

      <DocumentPrintDialog
        open={showDocumentDialog && hasActiveTab}
        labelDocument={labelDocument}
        templateDescription={templateDescription}
        templateTags={templateTags}
        templateSource={templateSource}
        activeTemplateId={activeTemplateId}
        appState={appState}
        currentPrinter={currentPrinter}
        refreshingPrinters={refreshingPrinters}
        saving={saving}
        printing={printing}
        onClose={() => setShowDocumentDialog(false)}
        onDocumentFieldChange={setDocumentField}
        onTemplateMetaChange={setActiveTemplateMeta}
        onRefreshPrinters={() => void refreshPrinters()}
        onSaveCurrentTemplate={() => void saveCurrentTemplate()}
        onSaveAsTemplate={() => void saveAsTemplate()}
        onPrintCurrent={printCurrent}
      />
    </div>
  )
}
