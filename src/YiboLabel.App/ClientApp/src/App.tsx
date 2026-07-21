import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import clsx from 'clsx'
import './App.css'
import './styles/floating-panels.css'
import { fetchAppState, fetchPrinters } from './api/appStateApi'
import {
  fetchLexiconGroups,
  fetchLexiconLibrary,
} from './api/lexiconsApi'
import { printDocument } from './api/printApi'
import { createFullDataBackup, openDataDirectory, restoreDataBackup } from './api/dataManagementApi'
import {
  createTemplate,
  deleteTemplate as deleteTemplateRequest,
  duplicateTemplate as duplicateTemplateRequest,
  fetchTemplate,
  fetchTemplates,
  moveTemplate as moveTemplateRequest,
  renameTemplate as renameTemplateRequest,
  updateTemplate,
} from './api/templatesApi'
import { getErrorMessage } from './api/http'
import { EditorCanvasPanel } from './components/EditorCanvasPanel'
import { ElementInspector, MultiSelectionInspector } from './components/ElementInspector'
import { ExportDialog, type ExportDialogOptions } from './components/ExportDialog'
import { PendingSavesDialog } from './components/PendingSavesDialog'
import { DocumentSpecPanel, PrintCalibrationPanel, PrintCheckSurface } from './components/PrintWorkflowPanels'
import { AboutDialog } from './components/AboutSurface'
import { TemplateEditorSidebar } from './components/TemplateEditorSidebar'
import { TemplatePreviewPanel } from './components/TemplatePreviewPanel'
import { UnsavedChangesDialog } from './components/UnsavedChangesDialog'
import { WorkspaceTopbar } from './components/WorkspaceTopbar'
import {
  createEditorTab,
  getTabKindLabel,
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
  getVisibleElementOverlapSummary,
  getMarqueeBounds,
  getSelectionBounds,
  getSnapTargets,
  pointFromPointer,
  reorderElements,
  snapMoveBounds,
  type Point,
  type SnapLine,
} from './domain/editorGeometry'
import { importLegacyTemplate } from './domain/legacyTemplateImport'
import {
  clamp,
  createBlankDocument,
  createContentPatch,
  createElement,
  createId,
  defaultFontFamily,
  getDefaultElementName,
  getQrTextAreaHeightMm,
  moveElementAfter,
  moveElementBefore,
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
  sortElementsByListOrder,
} from './domain/labelDocument'
import { renderLabelCanvasElementToDataUrl, renderLabelDocumentToDataUrl, renderLabelDocumentToPdfBase64 } from './domain/exportRenderer'
import { buildPrintCheckReport, createPrintCheckSignature, type EditorPanelMode, type WorkspaceSurface } from './domain/printWorkflow'
import {
  toTemplateSummary,
} from './domain/templateMetadata'
import type { LexiconActionRecord, LexiconActionSource } from './domain/lexiconActions'
import {
  getTabDisplayName,
  historyLimit,
  readWorkspaceSnapshot,
  workspaceStorageKey,
  type ClosedTabSnapshot,
  type EditorTab,
  type SidebarTab,
  type WorkspaceSnapshot,
} from './domain/workspace'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts'
import { useLexiconSidebarActions } from './hooks/useLexiconSidebarActions'
import {
  chooseExportPath,
  writeBase64ExportFile,
  writeTextExportFile,
} from './platform/exportBridge'
import { sendWindowChromeCommand, subscribeWindowChromeMessages } from './platform/windowChrome'
import {
  createDocumentSpecPreset,
  deleteDocumentSpecPreset,
  fetchDocumentSpecPresets,
  deletePrinterCalibration,
  fetchPrinterCalibrations,
  savePrinterCalibration,
  updateDocumentSpecPreset,
} from './api/printWorkflowApi'
import type {
  AppStateResponse,
  DocumentSpecPresetSummary,
  DuplicateTemplateRequest,
  ImageElement,
  LabelDocument,
  LabelElement,
  LabelTemplateRecord,
  LexiconLibrary,
  LabelTemplateSummary,
  LexiconGroupSummary,
  PrinterCalibrationRecord,
  RenameTemplateRequest,
} from './types'

const baseCanvasScale = 16
const githubUrl = 'https://github.com/datouluobo/YiboLabel'
const fallbackAppVersion = import.meta.env.VITE_APP_VERSION ?? null
const emptySelectionIds: string[] = []
const emptyHistoryState: EditorTab['history'] = { past: [], future: [] }
type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

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

type UnsavedDialogState = {
  mode: 'close-tab' | 'exit-review'
  tabId: string
  title: string
  body: string
  saveLabel: string
}

export default function App() {
  const [appState, setAppState] = useState<AppStateResponse | null>(null)
  const [templates, setTemplates] = useState<LabelTemplateSummary[]>([])
  const [documentSpecPresets, setDocumentSpecPresets] = useState<DocumentSpecPresetSummary[]>([])
  const [printerCalibrationProfiles, setPrinterCalibrationProfiles] = useState<PrinterCalibrationRecord[]>([])
  const [loadedCalibrationDevicePath, setLoadedCalibrationDevicePath] = useState<string | null>(null)
  const [templateQuery, setTemplateQuery] = useState('')
  const [lexiconGroups, setLexiconGroups] = useState<LexiconGroupSummary[]>([])
  const [lexiconLibrary, setLexiconLibrary] = useState<LexiconLibrary>({ schemaVersion: 1, lexicons: [] })
  const [activeLexiconId, setActiveLexiconId] = useState<string | null>(null)
  const [bindingOverlayEnabled, setBindingOverlayEnabled] = useState(false)
  const [bindingOverlayScope, setBindingOverlayScope] = useState<'selected' | 'all'>('selected')
  const [activeSidebarGroupId, setActiveSidebarGroupId] = useState<string | null>(null)
  const [lastLexiconAction, setLastLexiconAction] = useState<LexiconActionRecord | null>(null)
  const [tabs, setTabs] = useState<EditorTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [activeSurface, setActiveSurface] = useState<WorkspaceSurface>('editor')
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('elements')
  const [activeEditorPanel, setActiveEditorPanel] = useState<EditorPanelMode>('inspector')
  const [previewTemplateId, setPreviewTemplateId] = useState<string | null>(null)
  const [previewTemplateRecord, setPreviewTemplateRecord] = useState<LabelTemplateRecord | null>(null)
  const [previewTemplateLoading, setPreviewTemplateLoading] = useState(false)
  const [lastEditorTabId, setLastEditorTabId] = useState<string | null>(null)
  const [recentClosedTabs, setRecentClosedTabs] = useState<ClosedTabSnapshot[]>([])
  const [status, setStatus] = useState('正在加载本地标签工作台...')
  const [saving, setSaving] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [refreshingPrinters, setRefreshingPrinters] = useState(false)
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [dataManaging, setDataManaging] = useState(false)
  const [showAboutDialog, setShowAboutDialog] = useState(false)
  const [exportOptions, setExportOptions] = useState<ExportDialogOptions>({ format: 'pdf', pdfPaperMode: 'label' })
  const [unsavedDialog, setUnsavedDialog] = useState<UnsavedDialogState | null>(null)
  const [pendingSavesOpen, setPendingSavesOpen] = useState(false)
  const [exitReviewQueue, setExitReviewQueue] = useState<string[]>([])
  const [hostCloseRequestPending, setHostCloseRequestPending] = useState(false)
  const [windowIsMaximized, setWindowIsMaximized] = useState(false)
  const [, setActivity] = useState<string[]>([])
  const [interaction, setInteraction] = useState<EditorInteraction | null>(null)
  const [snapLines, setSnapLines] = useState<SnapLine[]>([])
  const [canvasViewportScale, setCanvasViewportScale] = useState(1)
  const [canvasUserZoom, setCanvasUserZoom] = useState(1)
  const [inlineEditorState, setInlineEditorState] = useState<{
    elementId: string
    draft: string
    initialValue: string
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const ddlInputRef = useRef<HTMLInputElement | null>(null)
  const backupInputRef = useRef<HTMLInputElement | null>(null)
  const canvasRef = useRef<HTMLDivElement | null>(null)
  const canvasWrapRef = useRef<HTMLDivElement | null>(null)
  const tabsRef = useRef<EditorTab[]>([])
  const allowImmediateCloseRef = useRef(false)
  const fallbackDocument = useMemo(() => createBlankDocument(), [])
  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [activeTabId, tabs])
  const hasActiveTab = activeTab !== null
  const labelDocument = activeTab?.document ?? fallbackDocument
  const selectedElementIds = activeTab?.selectedElementIds ?? emptySelectionIds
  const history = activeTab?.history ?? emptyHistoryState
  const activeTemplateId = activeTab?.templateId ?? null
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
    if (activeTabId && activeSurface === 'editor' && sidebarTab !== 'templates') {
      setLastEditorTabId(activeTabId)
    }
  }, [activeSurface, activeTabId, sidebarTab])

  useEffect(() => {
    const hasDirtyTabs = tabs.some((tab) => isTabDirty(tab))
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowImmediateCloseRef.current) {
        return
      }

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
      version: 11,
      activeTabId,
      ui: {
        activeSurface,
        lastEditorTabId,
        activeEditorPanel: hasActiveTab ? activeEditorPanel : 'inspector',
        sidebarTab,
        previewTemplateId,
      },
      tabs: tabs.map((tab) => ({
        id: tab.id,
        templateId: tab.templateId,
        origin: tab.origin,
        document: tab.document,
        selectedElementIds: tab.selectedElementIds,
        history: tab.history,
        lastSavedSnapshot: tab.lastSavedSnapshot,
      })),
    }

    window.localStorage.setItem(workspaceStorageKey, JSON.stringify(snapshot))
  }, [activeEditorPanel, activeSurface, activeTabId, hasActiveTab, lastEditorTabId, previewTemplateId, sidebarTab, tabs])

  const sortedElements = useMemo(() => (hasActiveTab ? sortElements(labelDocument.elements) : []), [hasActiveTab, labelDocument.elements])
  const visibleElements = useMemo(() => sortedElements.filter((element) => !element.hidden), [sortedElements])
  const visibleOverlapSummary = useMemo(() => getVisibleElementOverlapSummary(visibleElements), [visibleElements])
  const selectedElements = useMemo(
    () => sortElements(labelDocument.elements.filter((element) => selectedElementIds.includes(element.id))),
    [labelDocument.elements, selectedElementIds],
  )
  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : null
  const currentTabLexiconAction = lastLexiconAction && activeTabId && lastLexiconAction.tabId === activeTabId
    ? lastLexiconAction
    : null
  const bindableSelectedElements = useMemo(
    () => selectedElements.filter(isLexiconEnabledElement),
    [selectedElements],
  )
  const currentPrinter = useMemo(() => {
    const devicePath = labelDocument.printerDevicePath ?? appState?.printers[0]?.devicePath
    return appState?.printers.find((printer) => printer.devicePath === devicePath) ?? null
  }, [appState?.printers, labelDocument.printerDevicePath])
  const activeSourcePreset = useMemo(
    () => documentSpecPresets.find((preset) => preset.id === labelDocument.sourceSpecId) ?? null,
    [documentSpecPresets, labelDocument.sourceSpecId],
  )
  const sourcePresetChanged = useMemo(
    () =>
      activeSourcePreset !== null
      && (
        activeSourcePreset.widthMm !== labelDocument.widthMm
        || activeSourcePreset.heightMm !== labelDocument.heightMm
        || activeSourcePreset.gapMm !== labelDocument.gapMm
      ),
    [activeSourcePreset, labelDocument.gapMm, labelDocument.heightMm, labelDocument.widthMm],
  )
  const activeTabDirty = activeTab ? isTabDirty(activeTab) : false
  const printCheckReport = useMemo(
    () =>
      buildPrintCheckReport({
        document: labelDocument,
        currentPrinter,
        activeTabDirty,
        visibleElements,
        overlapSummary: visibleOverlapSummary,
      }),
    [activeTabDirty, currentPrinter, labelDocument, visibleElements, visibleOverlapSummary],
  )
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
  const previewTemplateOpenState = useMemo(
    () => (previewTemplateId ? openedTemplateState.get(previewTemplateId) ?? null : null),
    [openedTemplateState, previewTemplateId],
  )
  const visibleTemplates = useMemo(() => {
    const query = templateQuery.trim().toLowerCase()
    return query.length === 0
      ? templates
      : templates.filter((template) =>
          template.name.toLowerCase().includes(query),
        )
  }, [templateQuery, templates])
  const selectedVisibleElements = selectedElements.filter((element) => !element.hidden)
  const selectionBounds = useMemo(() => getSelectionBounds(selectedVisibleElements), [selectedVisibleElements])
  const marqueeBounds = interaction?.mode === 'marquee' ? getMarqueeBounds(interaction.start, interaction.current) : null
  const resolvedVisibleElements = visibleElements
  const listOrderedElements = useMemo(() => sortElementsByListOrder(labelDocument.elements), [labelDocument.elements])
  const horizontalRulerTicks = useMemo(() => createRulerTicks(labelDocument.widthMm), [labelDocument.widthMm])
  const verticalRulerTicks = useMemo(() => createRulerTicks(labelDocument.heightMm), [labelDocument.heightMm])
  const bindingOverlayElements = useMemo(() => {
    if (!bindingOverlayEnabled) {
      return []
    }

    const visibleGroupMap = new Map(lexiconGroups.map((group) => [group.id, group.name]))
    const visibleTargets = bindingOverlayScope === 'selected'
      ? labelDocument.elements.filter((element) => selectedElementIds.includes(element.id))
      : labelDocument.elements

    return visibleTargets
      .filter(isLexiconEnabledElement)
      .filter((element) => !element.hidden && (element.lexiconGroupIds?.length ?? 0) > 0)
      .map((element) => {
        const groupNames = (element.lexiconGroupIds ?? [])
          .map((groupId) => visibleGroupMap.get(groupId))
          .filter((name): name is string => Boolean(name))

        return {
          elementId: element.id,
          names: groupNames,
        }
      })
  }, [bindingOverlayEnabled, bindingOverlayScope, labelDocument.elements, lexiconGroups, selectedElementIds])
  const dirtyTabs = useMemo(() => tabs.filter((tab) => isTabDirty(tab)), [tabs])
  const pendingSaveItems = useMemo(
    () =>
      dirtyTabs.map((tab) => ({
        tabId: tab.id,
        name: getTabDisplayName(tab),
        kindLabel: getTabKindLabel(tab),
        dirty: true,
      })),
    [dirtyTabs],
  )
  const canvasScale = baseCanvasScale * canvasViewportScale * canvasUserZoom
  const inlineEditingElement = useMemo(() => {
    if (!inlineEditorState) {
      return null
    }

    const element = labelDocument.elements.find((item) => item.id === inlineEditorState.elementId) ?? null
    return isLexiconEnabledElement(element) ? element : null
  }, [inlineEditorState, labelDocument.elements])

  useEffect(() => {
    void bootstrap()
  }, [])

  useEffect(() => {
    if (!previewTemplateId) {
      setPreviewTemplateRecord(null)
      setPreviewTemplateLoading(false)
      return
    }

    const summary = templates.find((template) => template.id === previewTemplateId)
    if (!summary) {
      setPreviewTemplateId(null)
      setPreviewTemplateRecord(null)
      setPreviewTemplateLoading(false)
      return
    }

    if (previewTemplateRecord?.id === previewTemplateId && previewTemplateRecord.updatedAt === summary.updatedAt) {
      return
    }

    let cancelled = false
    setPreviewTemplateLoading(true)
    void fetchTemplate(previewTemplateId)
      .then((record) => {
        if (!cancelled) {
          setPreviewTemplateRecord(record)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(getErrorMessage(error))
          setPreviewTemplateRecord(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setPreviewTemplateLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [previewTemplateId, previewTemplateRecord?.id, previewTemplateRecord?.updatedAt, templates])

  useEffect(() => {
    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault()
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: false, capture: true })
    return () => window.removeEventListener('wheel', handleWheel, { capture: true })
  }, [])

  useEffect(() => {
    if (!inlineEditorState) {
      return
    }

    const element = labelDocument.elements.find((item) => item.id === inlineEditorState.elementId) ?? null
    if (!isLexiconEnabledElement(element) || !selectedElementIds.includes(inlineEditorState.elementId)) {
      setInlineEditorState(null)
    }
  }, [inlineEditorState, labelDocument.elements, selectedElementIds])

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

  const templateExists = useCallback((templateId: string) => templates.some((template) => template.id === templateId), [templates])

  const selectPreviewTemplate = useCallback((templateId: string | null) => {
    setPreviewTemplateId(templateId)
  }, [])

  const restoreLastEditorTabOrBlank = useCallback(() => {
    const targetId = lastEditorTabId ?? activeTabId ?? tabsRef.current[0]?.id ?? null
    if (targetId) {
      setActiveTabId(targetId)
      setLastEditorTabId(targetId)
    }
  }, [activeTabId, lastEditorTabId])

  function handleSidebarTabChange(nextTab: SidebarTab) {
    if (nextTab === 'templates') {
      if (activeTab?.origin === 'template' && activeTab.templateId && templateExists(activeTab.templateId)) {
        setPreviewTemplateId(activeTab.templateId)
      } else if (previewTemplateId && !templateExists(previewTemplateId)) {
        setPreviewTemplateId(null)
      }

      setSidebarTab('templates')
      setActiveSurface('editor')
      setActiveEditorPanel('inspector')
      return
    }

    if (sidebarTab === 'templates' && nextTab === 'elements') {
      if (previewTemplateId && templateExists(previewTemplateId)) {
        void loadTemplate(previewTemplateId, { forceSidebarTab: 'elements' })
      } else {
        restoreLastEditorTabOrBlank()
      }
    }

    if (nextTab === 'lexicon') {
      restoreLastEditorTabOrBlank()
    }

    setSidebarTab(nextTab)
    setActiveSurface('editor')
  }

  function showEditor(tabId?: string | null) {
    const targetId = tabId ?? lastEditorTabId ?? activeTabId ?? tabsRef.current[0]?.id ?? null
    if (targetId) {
      setActiveTabId(targetId)
      setLastEditorTabId(targetId)
    }
    setSidebarTab('elements')
    setActiveSurface('editor')
  }

  function openDocumentSpecPanel() {
    if (activeSurface === 'editor' && activeEditorPanel === 'document-spec') {
      setActiveEditorPanel('inspector')
      return
    }

    showEditor()
    setActiveEditorPanel('document-spec')
  }

  function openPrintCalibrationPanel() {
    if (activeSurface === 'editor' && activeEditorPanel === 'print-calibration') {
      setActiveEditorPanel('inspector')
      return
    }

    showEditor()
    setActiveEditorPanel('print-calibration')
  }

  function openPrintCheckSurface() {
    if (!hasActiveTab) {
      return
    }

    if (activeSurface === 'print-check') {
      showEditor()
      setActiveEditorPanel('inspector')
      return
    }

    setActiveEditorPanel('inspector')
    setActiveSurface('print-check')
  }

  function getLexiconActionElementName(element: LabelElement) {
    return element.name ?? getDefaultElementName(element.type)
  }

  function getLexiconActionGroupName(groupId: string) {
    return lexiconGroups.find((group) => group.id === groupId)?.name ?? '未命名分组'
  }

  function setElementGroupBinding(elementId: string, groupId: string, shouldBind: boolean, options: { activateGroup?: boolean } = {}) {
    const { activateGroup = true } = options
    const target = labelDocument.elements.find((element) => element.id === elementId) ?? null
    if (!isLexiconEnabledElement(target)) {
      return { ok: false as const, changed: false, target: null, groupName: getLexiconActionGroupName(groupId) }
    }

    const currentlyBound = (target.lexiconGroupIds ?? []).includes(groupId)
    if (currentlyBound === shouldBind) {
      return { ok: true as const, changed: false, target, groupName: getLexiconActionGroupName(groupId) }
    }

    const groupName = getLexiconActionGroupName(groupId)

    updateDocument((current) => ({
      ...current,
      elements: current.elements.map((element) => {
        if (element.id !== elementId || !isLexiconEnabledElement(element)) {
          return element
        }

        const currentGroupIds = element.lexiconGroupIds ?? []
        const nextGroupIds = shouldBind
          ? [...new Set([...currentGroupIds, groupId])]
          : currentGroupIds.filter((id) => id !== groupId)

        return {
          ...element,
          lexiconGroupIds: nextGroupIds,
          defaultLexiconGroupId: nextGroupIds.includes(element.defaultLexiconGroupId ?? '') ? element.defaultLexiconGroupId : nextGroupIds[0] ?? null,
        } as LabelElement
      }),
    }))

    if (activateGroup && !shouldBind && activeSidebarGroupId === groupId) {
      setActiveSidebarGroupId(null)
    }
    if (activateGroup && shouldBind) {
      setActiveSidebarGroupId(groupId)
    }

    return { ok: true as const, changed: true, target, groupName }
  }

  function toggleLexiconGroupForElement(elementId: string, groupId: string) {
    const target = labelDocument.elements.find((element) => element.id === elementId) ?? null
    if (!isLexiconEnabledElement(target)) {
      return
    }

    const currentlyBound = (target.lexiconGroupIds ?? []).includes(groupId)
    if (currentlyBound) {
      void unbindLexiconGroupFromElement(elementId, groupId, { source: 'popover' })
      return
    }

    void bindLexiconGroupToElement(elementId, groupId, { source: 'popover' })
  }

  function bindLexiconGroupToElement(
    elementId: string,
    groupId: string,
    options: { source?: LexiconActionSource; record?: boolean; silent?: boolean; activateGroup?: boolean } = {},
  ) {
    const { source = 'button', record = true, silent = false, activateGroup = true } = options
    const result = setElementGroupBinding(elementId, groupId, true, { activateGroup })
    if (!result.ok || !result.target) {
      if (!silent) {
        setStatus('不可绑定：该元素不支持词库。')
      }
      return false
    }

    if (!result.changed) {
      if (!silent) {
        if (activateGroup) {
          setActiveSidebarGroupId(groupId)
        }
        setStatus(`当前元素已绑定分组：${result.groupName}`)
      }
      return false
    }

    if (record) {
      setLastLexiconAction({
        kind: 'bind-group',
        tabId: activeTabId ?? '',
        elementId,
        elementName: getLexiconActionElementName(result.target),
        groupId,
        groupName: result.groupName,
        source,
      })
    }

    if (!silent) {
      setStatus(`已绑定分组：${result.groupName} -> ${getLexiconActionElementName(result.target)}`)
    }
    return true
  }

  function unbindLexiconGroupFromElement(
    elementId: string,
    groupId: string,
    options: { source?: LexiconActionSource; record?: boolean; silent?: boolean; activateGroup?: boolean } = {},
  ) {
    const { source = 'button', record = true, silent = false, activateGroup = true } = options
    const result = setElementGroupBinding(elementId, groupId, false, { activateGroup })
    if (!result.ok || !result.target) {
      if (!silent) {
        setStatus('不可取消绑定：该元素不支持词库。')
      }
      return false
    }

    if (!result.changed) {
      if (!silent) {
        setStatus(`当前元素未绑定分组：${result.groupName}`)
      }
      return false
    }

    if (record) {
      setLastLexiconAction({
        kind: 'unbind-group',
        tabId: activeTabId ?? '',
        elementId,
        elementName: getLexiconActionElementName(result.target),
        groupId,
        groupName: result.groupName,
        source,
      })
    }

    if (!silent) {
      setStatus(`已取消绑定：${result.groupName} -> ${getLexiconActionElementName(result.target)}`)
    }
    return true
  }

  function applyEntryToElement(
    elementId: string,
    text: string,
    groupId: string | null,
    options: { source?: LexiconActionSource; record?: boolean; silent?: boolean; activateGroup?: boolean; ignoreLock?: boolean } = {},
  ) {
    const { source = 'button', record = true, silent = false, activateGroup = true, ignoreLock = false } = options
    const target = labelDocument.elements.find((element) => element.id === elementId) ?? null
    if (!isLexiconEnabledElement(target)) {
      if (!silent) {
        setStatus('不可应用：该元素不支持文本。')
      }
      return false
    }

    if (target.locked && !ignoreLock) {
      if (!silent) {
        setStatus('不可应用：目标元素已锁定。')
      }
      return false
    }

    const previousValue = target.type === 'text' ? target.text : target.value
    updateElementById(elementId, createContentPatch(target, text))
    setInlineEditorState(null)
    if (groupId && activateGroup) {
      setActiveSidebarGroupId(groupId)
    }

    if (record) {
      setLastLexiconAction({
        kind: 'apply-entry',
        tabId: activeTabId ?? '',
        elementId,
        elementName: getLexiconActionElementName(target),
        groupId,
        groupName: groupId ? getLexiconActionGroupName(groupId) : null,
        entryText: text,
        previousValue,
        nextValue: text,
        source,
      })
    }

    if (!silent) {
      setStatus(`已应用条目：${text} -> ${getLexiconActionElementName(target)}`)
    }
    return true
  }

  function undoLastLexiconSidebarAction() {
    if (!currentTabLexiconAction) {
      return
    }

    if (currentTabLexiconAction.kind === 'bind-group') {
      const reverted = unbindLexiconGroupFromElement(currentTabLexiconAction.elementId, currentTabLexiconAction.groupId, { record: false, silent: true, activateGroup: false })
      if (reverted) {
        setStatus(`已撤消绑定：${currentTabLexiconAction.groupName}`)
      }
      setLastLexiconAction(null)
      return
    }

    if (currentTabLexiconAction.kind === 'unbind-group') {
      const reverted = bindLexiconGroupToElement(currentTabLexiconAction.elementId, currentTabLexiconAction.groupId, { record: false, silent: true, activateGroup: false })
      if (reverted) {
        setStatus(`已恢复绑定：${currentTabLexiconAction.groupName}`)
      }
      setLastLexiconAction(null)
      return
    }

    const reverted = applyEntryToElement(currentTabLexiconAction.elementId, currentTabLexiconAction.previousValue, currentTabLexiconAction.groupId, { record: false, silent: true, activateGroup: false, ignoreLock: true })
    if (reverted) {
      setStatus(`已撤消应用：${currentTabLexiconAction.elementName}`)
    }
    setLastLexiconAction(null)
  }

  function handleLexiconBindGroupToElement(elementId: string, groupId: string, source: LexiconActionSource = 'button') {
    return bindLexiconGroupToElement(elementId, groupId, { source })
  }

  function handleLexiconUnbindGroupFromElement(elementId: string, groupId: string, source: LexiconActionSource = 'button') {
    return unbindLexiconGroupFromElement(elementId, groupId, { source })
  }

  function handleLexiconApplyEntryToElement(elementId: string, text: string, groupId: string | null, source: LexiconActionSource = 'button') {
    return applyEntryToElement(elementId, text, groupId, { source })
  }

  function openTab(nextTab: EditorTab) {
    setTabs((currentTabs) => [...currentTabs, nextTab])
    setActiveTabId(nextTab.id)
    setLastEditorTabId(nextTab.id)
    setSidebarTab('elements')
    setActiveSurface('editor')
    setInteraction(null)
    setSnapLines([])
  }

  function getTabById(tabId: string) {
    return tabsRef.current.find((tab) => tab.id === tabId) ?? null
  }

  function buildUnsavedDialogState(tab: EditorTab, mode: UnsavedDialogState['mode']): UnsavedDialogState {
    const name = getTabDisplayName(tab)
    if (tab.origin === 'template' && tab.templateId) {
      return {
        mode,
        tabId: tab.id,
        title: `“${name}”有未保存修改`,
        body: '关闭前是否保存到原模板？',
        saveLabel: '保存',
      }
    }

    if (tab.origin === 'imported') {
      return {
        mode,
        tabId: tab.id,
        title: `“${name}”有未保存修改`,
        body: '它还不是模板。关闭前是否另存为模板？',
        saveLabel: '另存为模板',
      }
    }

    if (tab.origin === 'detached') {
      return {
        mode,
        tabId: tab.id,
        title: `“${name}”有未保存修改`,
        body: '对应模板已删除。关闭前是否另存为新模板？',
        saveLabel: '另存为模板',
      }
    }

    return {
      mode,
      tabId: tab.id,
      title: `“${name}”有未保存修改`,
      body: '关闭前是否另存为模板？',
      saveLabel: '另存为模板',
    }
  }

  function closeTabImmediate(tabId: string) {
    const closingTab = getTabById(tabId)
    if (!closingTab) {
      return
    }

    setRecentClosedTabs((current) =>
      [
        {
          templateId: closingTab.templateId,
          origin: closingTab.origin,
          document: normalizeDocument(closingTab.document),
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
          setStatus('工作区已清空。可新建草稿、导入为草稿，或从模板库重新打开模板。')
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

  function closeTab(tabId: string) {
    const closingTab = tabs.find((tab) => tab.id === tabId)
    if (!closingTab) {
      return
    }

    if (isTabDirty(closingTab)) {
      setUnsavedDialog(buildUnsavedDialogState(closingTab, 'close-tab'))
      return
    }

    closeTabImmediate(tabId)
  }

  function reopenLastClosedTab() {
    const [nextClosedTab, ...remaining] = recentClosedTabs
    if (!nextClosedTab) {
      return
    }

    const reopenedTab = createEditorTab(nextClosedTab.document, {
      templateId: nextClosedTab.templateId,
      origin: nextClosedTab.origin,
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
        const dragThreshold = 3 / canvasScale
        if (Math.hypot(dx, dy) < dragThreshold) {
          setSnapLines([])
          return
        }

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
      const [stateResponse, templatesResponse, specPresetsResponse, lexiconGroupsResponse, lexiconLibraryResponse] = await Promise.all([
        fetchAppState(),
        fetchTemplates(),
        fetchDocumentSpecPresets(true),
        fetchLexiconGroups(),
        fetchLexiconLibrary(),
      ])

      setAppState(stateResponse)
      setTemplates(templatesResponse)
      setDocumentSpecPresets(specPresetsResponse)
      setLexiconGroups(lexiconGroupsResponse)
      setLexiconLibrary(lexiconLibraryResponse)
      setActiveLexiconId((current) => current ?? lexiconLibraryResponse.lexicons[0]?.id ?? null)
      const savedWorkspace = readWorkspaceSnapshot()
      const restoredTabs = savedWorkspace?.tabs.map((tab) => normalizeEditorTab(tab)) ?? []

      if (restoredTabs.length > 0) {
        const restoredSurface = savedWorkspace?.ui?.activeSurface ?? 'editor'
        setTabs(restoredTabs)
        setActiveTabId(savedWorkspace?.activeTabId && restoredTabs.some((tab) => tab.id === savedWorkspace.activeTabId) ? savedWorkspace.activeTabId : restoredTabs[0].id)
        setLastEditorTabId(savedWorkspace?.ui?.lastEditorTabId ?? savedWorkspace?.activeTabId ?? restoredTabs[0].id)
        setActiveSurface(restoredSurface)
        setActiveEditorPanel(savedWorkspace?.ui?.activeEditorPanel ?? 'inspector')
        setSidebarTab(savedWorkspace?.ui?.sidebarTab ?? 'elements')
        setPreviewTemplateId(savedWorkspace?.ui?.previewTemplateId ?? null)
        setStatus(`已恢复上次工作区，共 ${restoredTabs.length} 个标签页。`)
        return
      }

      if (templatesResponse.length > 0) {
        setTabs([])
        setActiveTabId(null)
        setActiveSurface('editor')
        setSidebarTab('templates')
        setStatus(`已加载模板库，共 ${templatesResponse.length} 个模板。`)
        return
      }

      const next = createEditorTab(createBlankDocument(), { origin: 'blank' })
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

  async function refreshDocumentSpecPresets(includeHidden = true) {
    setDocumentSpecPresets(await fetchDocumentSpecPresets(includeHidden))
  }

  function upsertTemplateSummary(record: LabelTemplateRecord) {
    const summary = toTemplateSummary(record)
    setTemplates((current) => {
      const next = current.some((template) => template.id === summary.id)
        ? current.map((template) => (template.id === summary.id ? summary : template))
        : [...current, summary]
      next.sort((left, right) => {
        if (left.sortOrder !== right.sortOrder) {
          return left.sortOrder - right.sortOrder
        }

        return right.updatedAt.localeCompare(left.updatedAt)
      })
      return next
    })
  }

  async function moveSidebarTemplate(movingTemplateId: string, anchorTemplateId: string, placement: 'before' | 'after') {
    if (movingTemplateId === anchorTemplateId) {
      return
    }

    try {
      const moved = await moveTemplateRequest(movingTemplateId, {
        anchorId: anchorTemplateId,
        placement,
      })
      setTemplates(moved)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function refreshLexiconGroups() {
    const [groups, library] = await Promise.all([
      fetchLexiconGroups(),
      fetchLexiconLibrary(),
    ])
    setLexiconGroups(groups)
    setLexiconLibrary(library)
    setActiveLexiconId((current) => current && library.lexicons.some((lexicon) => lexicon.id === current) ? current : library.lexicons[0]?.id ?? null)
  }

  const {
    createSidebarLexiconGroup,
    renameSidebarLexiconGroup,
    deleteSidebarLexiconGroup,
    moveSidebarLexiconGroup,
    createSidebarLexiconEntry,
    renameSidebarLexiconEntry,
    deleteSidebarLexiconEntry,
    moveSidebarLexiconEntry,
  } = useLexiconSidebarActions({
    lexiconLibrary,
    activeLexiconId,
    activeSidebarGroupId,
    setActiveLexiconId,
    setActiveSidebarGroupId,
    setStatus,
    refreshLexiconGroups,
  })

  function applySavedTemplateToTabs(saved: LabelTemplateRecord, savingTabId: string, snapshotAtSaveStart: string) {
    const normalized = normalizeDocument(saved.document)
    const savedSnapshot = serializeTabSnapshot({
      document: normalized,
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
            origin: 'template',
            document: normalized,
            lastSavedSnapshot: savedSnapshot,
          }
        }

        return {
          ...tab,
          templateId: saved.id,
          origin: 'template',
          lastSavedSnapshot: savedSnapshot,
        }
      }),
    )
  }

  const applyPrinterCalibration = useCallback((record: PrinterCalibrationRecord | null, printerName: string, devicePath: string) => {
    updateDocument((current) => ({
      ...current,
      calibrationPrinterDevicePath: devicePath,
      calibrationProfileId: record?.id ?? null,
      printCalibrationState: record?.state ?? 'unset',
      printCalibrationLabel: record?.label ?? (printerName ? '未设置' : null),
      printOffsetXMm: record?.printOffsetXMm ?? 0,
      printOffsetYMm: record?.printOffsetYMm ?? 0,
      printRotation: record?.printRotation ?? 0,
      darkness: record?.darkness ?? 8,
      printInvert: record?.printInvert ?? false,
    }), { pushHistory: false })
  }, [updateDocument])

  function sortCalibrationProfiles(profiles: PrinterCalibrationRecord[]) {
    return [...profiles].sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1
      }

      const updatedAtComparison = right.updatedAt.localeCompare(left.updatedAt)
      if (updatedAtComparison !== 0) {
        return updatedAtComparison
      }

      return left.label.localeCompare(right.label, 'zh-CN')
    })
  }

  const loadCalibrationForPrinter = useCallback(async (devicePath: string, printerName: string) => {
    try {
      const calibrations = await fetchPrinterCalibrations(devicePath)
      setPrinterCalibrationProfiles(calibrations)
      setLoadedCalibrationDevicePath(devicePath)
      const selected = calibrations.find((item) => item.id === documentRef.current.calibrationProfileId) ?? calibrations[0] ?? null
      applyPrinterCalibration(selected, printerName, devicePath)
    } catch {
      setPrinterCalibrationProfiles([])
      setLoadedCalibrationDevicePath(devicePath)
      applyPrinterCalibration(null, printerName, devicePath)
    }
  }, [applyPrinterCalibration])

  useEffect(() => {
    if (!hasActiveTab || !currentPrinter?.devicePath) {
      setPrinterCalibrationProfiles([])
      setLoadedCalibrationDevicePath(null)
      return
    }

    if (loadedCalibrationDevicePath === currentPrinter.devicePath) {
      return
    }

    void loadCalibrationForPrinter(currentPrinter.devicePath, currentPrinter.displayName)
  }, [currentPrinter?.devicePath, currentPrinter?.displayName, hasActiveTab, loadedCalibrationDevicePath, loadCalibrationForPrinter])

  async function loadTemplate(id: string, options?: { forceSidebarTab?: SidebarTab }) {
    const template = await fetchTemplate(id)
    const existingTab = tabsRef.current.find((tab) => tab.templateId === template.id)
    if (existingTab) {
      showEditor(existingTab.id)
      if (options?.forceSidebarTab) {
        setSidebarTab(options.forceSidebarTab)
      }
      setStatus(`已切换到模板：${template.name}`)
      return
    }

    const normalized = normalizeDocument(template.document)
    openTab(
      createEditorTab(normalized, {
        templateId: template.id,
        origin: 'template',
      }),
    )
    if (options?.forceSidebarTab) {
      setSidebarTab(options.forceSidebarTab)
    }
    setStatus(`已加载模板：${template.name}`)
  }

  async function saveCurrentTemplate() {
    if (!activeTabId) {
      return
    }

    await saveTab(activeTabId)
  }

  async function persistCurrentDocument(options?: { silent?: boolean; documentOverride?: LabelDocument }) {
    if (!activeTabId) {
      return
    }

    await saveTab(activeTabId, { silent: options?.silent, documentOverride: options?.documentOverride })
  }

  async function saveAsTemplate() {
    if (!activeTabId) {
      return
    }

    await saveTab(activeTabId, { forceSaveAs: true })
  }

  async function saveTab(tabId: string, options?: { forceSaveAs?: boolean; silent?: boolean; documentOverride?: LabelDocument }) {
    const tab = getTabById(tabId)
    if (!tab) {
      return false
    }

    const documentToSave = options?.documentOverride ? normalizeDocument(options.documentOverride) : tab.document

    if (!options?.forceSaveAs && tab.templateId) {
      setSaving(true)
      try {
        const saved = await updateTemplate(tab.templateId, {
          name: documentToSave.name,
          document: documentToSave,
        })

        applySavedTemplateToTabs(saved, tab.id, serializeTabSnapshot(tab))
        upsertTemplateSummary(saved)
        if (!options?.silent) {
          setStatus(`已保存模板：${saved.name}`)
          queueActivity(`已保存模板：${saved.name}`)
        }
        await refreshTemplateLibrary()
        return true
      } catch (error) {
        if (!options?.silent) {
          setStatus(getErrorMessage(error))
        }
        return false
      } finally {
        setSaving(false)
      }
    }

    const suggestedName = documentToSave.name?.trim() || '未命名标签'
    const targetName = window.prompt('另存为模板名称', suggestedName)?.trim()
    if (!targetName) {
      return false
    }

    setSaving(true)
    try {
      const saved = await createTemplate({
        name: targetName,
        document: {
          ...documentToSave,
          name: targetName,
        },
      })

      applySavedTemplateToTabs(saved, tab.id, serializeTabSnapshot(tab))
      upsertTemplateSummary(saved)
      if (!options?.silent) {
        setStatus(`已另存为模板：${saved.name}`)
        queueActivity(`已另存为模板：${saved.name}`)
      }
      await refreshTemplateLibrary()
      return true
    } catch (error) {
      if (!options?.silent) {
        setStatus(getErrorMessage(error))
      }
      return false
    } finally {
      setSaving(false)
    }
  }

  const completeAppClose = useCallback(() => {
    allowImmediateCloseRef.current = true
    setHostCloseRequestPending(false)
    sendWindowChromeCommand('force-close')
  }, [])

  const requestAppClose = useCallback((source: 'app' | 'host' = 'app') => {
    allowImmediateCloseRef.current = false

    if (dirtyTabs.length === 0) {
      completeAppClose()
      return
    }

    if (source === 'app') {
      setHostCloseRequestPending(false)
    }
    setPendingSavesOpen(true)
  }, [completeAppClose, dirtyTabs.length])

  useEffect(() => {
    sendWindowChromeCommand('sync-state')
    return subscribeWindowChromeMessages((message) => {
      if (message.command === 'state-changed') {
        setWindowIsMaximized(message.isMaximized)
        return
      }

      setHostCloseRequestPending(true)
      requestAppClose('host')
    })
  }, [requestAppClose])

  function startExitReview(tabIds: string[]) {
    if (tabIds.length === 0) {
      completeAppClose()
      return
    }

    const [currentTabId, ...remaining] = tabIds
    const currentTab = getTabById(currentTabId)
    if (!currentTab) {
      startExitReview(remaining)
      return
    }

    setExitReviewQueue(remaining)
    setPendingSavesOpen(false)
    setUnsavedDialog(buildUnsavedDialogState(currentTab, 'exit-review'))
  }

  async function handleSaveAllBeforeExit() {
    for (const tab of dirtyTabs) {
      const saved = await saveTab(tab.id)
      if (!saved) {
        setPendingSavesOpen(false)
        abortPendingHostClose()
        return
      }
    }

    setPendingSavesOpen(false)
    completeAppClose()
  }

  function continueExitReview() {
    startExitReview(exitReviewQueue)
  }

  async function handleUnsavedDialogSave() {
    if (!unsavedDialog) {
      return
    }

    const saved = await saveTab(unsavedDialog.tabId)
    if (!saved) {
      if (unsavedDialog.mode === 'exit-review') {
        setExitReviewQueue([])
        setUnsavedDialog(null)
        abortPendingHostClose()
      }
      return
    }

    if (unsavedDialog.mode === 'close-tab') {
      closeTabImmediate(unsavedDialog.tabId)
      setUnsavedDialog(null)
      return
    }

    setUnsavedDialog(null)
    continueExitReview()
  }

  function handleUnsavedDialogDiscard() {
    if (!unsavedDialog) {
      return
    }

    if (unsavedDialog.mode === 'close-tab') {
      closeTabImmediate(unsavedDialog.tabId)
      setUnsavedDialog(null)
      return
    }

    setUnsavedDialog(null)
    continueExitReview()
  }

  function handleUnsavedDialogCancel() {
    setUnsavedDialog(null)
    setExitReviewQueue([])
    abortPendingHostClose()
  }

  function abortPendingHostClose() {
    allowImmediateCloseRef.current = false
    if (!hostCloseRequestPending) {
      return
    }

    setHostCloseRequestPending(false)
    sendWindowChromeCommand('cancel-close')
  }

  async function renameTemplate(template: LabelTemplateSummary) {
    const nextName = window.prompt('输入新的模板名称', template.name)?.trim()
    if (!nextName || nextName === template.name) {
      return
    }

    try {
      const saved = await renameTemplateRequest(template.id, {
        name: nextName,
      } satisfies RenameTemplateRequest)

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
            lastSavedSnapshot: serializeTabSnapshot({
              document: {
                ...(lastSavedDocument ?? tab.document),
                name: saved.name,
              },
            }),
          }
        }),
      )
      setPreviewTemplateRecord((current) => current?.id === saved.id ? saved : current)
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
      setPreviewTemplateId(duplicated.id)
      setPreviewTemplateRecord(duplicated)
      setSidebarTab('templates')
      await refreshTemplateLibrary()
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
                origin: 'detached',
                lastSavedSnapshot: serializeTabSnapshot({
                  document: tab.document,
                }),
              }
            : tab,
        ),
      )
      if (previewTemplateId === template.id) {
        setPreviewTemplateId(null)
        setPreviewTemplateRecord(null)
      }
      await refreshTemplateLibrary()
      setStatus(`已删除模板：${template.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  function buildCheckedDocument() {
    return normalizeDocument({
      ...documentRef.current,
      lastPrintCheckSignature: createPrintCheckSignature(documentRef.current, currentPrinter),
    })
  }

  async function printCurrent(options?: { markChecked?: boolean; statusLabel?: string }) {
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
      const documentToPrint = options?.markChecked ? buildCheckedDocument() : documentRef.current
      const response = await printDocument({
        document: documentToPrint,
        devicePathOverride: currentPrinter.devicePath,
      })
      if (options?.markChecked) {
        updateActiveTab((tab) => ({
          ...tab,
          document: documentToPrint,
        }))
      }
      await persistCurrentDocument({ silent: true, documentOverride: documentToPrint })

      setStatus(options?.statusLabel ?? `打印已发送到设备：${response.devicePath}`)
      queueActivity(`已打印：${documentRef.current.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    } finally {
      setPrinting(false)
    }
  }

  async function exportCurrent() {
    if (!activeTab || exporting) {
      return
    }

    const options = exportOptions
    const format = options.format
    const suggestedName = buildExportFileName(labelDocument.name, format)
    setExporting(true)

    try {
      await waitForPaint()
      const saveResult = await chooseExportPath(format, suggestedName)
      if (saveResult.cancelled || !saveResult.path) {
        setStatus('已取消导出。')
        return
      }

      if (format === 'template') {
        await writeTextExportFile(saveResult.path, buildTemplateExportJson(labelDocument))
      } else if (format === 'png' || format === 'jpg') {
        const dataUrl = canvasRef.current
          ? await renderLabelCanvasElementToDataUrl(canvasRef.current, labelDocument, format)
          : await renderLabelDocumentToDataUrl(labelDocument, format)
        await writeBase64ExportFile(saveResult.path, dataUrlToBase64(dataUrl))
      } else {
        if (!canvasRef.current) {
          throw new Error('没有可导出的标签画布。')
        }

        const pdfBase64 = await renderLabelDocumentToPdfBase64(canvasRef.current, labelDocument, options.pdfPaperMode)
        await writeBase64ExportFile(saveResult.path, pdfBase64)
      }

      const fileName = saveResult.fileName ?? suggestedName
      setStatus(`已导出 ${getExportFormatLabel(format)}：${fileName}`)
      queueActivity(`已导出 ${getExportFormatLabel(format)}：${labelDocument.name}`)
      setShowExportDialog(false)
    } catch (error) {
      setStatus(`导出失败：${getErrorMessage(error)}`)
    } finally {
      setExporting(false)
    }
  }

  async function backupAllData() {
    if (dataManaging) {
      return
    }

    setDataManaging(true)
    try {
      const result = await createFullDataBackup()
      setStatus(`已备份全部数据：${result.fileName}`)
      queueActivity(`已备份数据：${result.fileName}`)
    } catch (error) {
      setStatus(`备份失败：${getErrorMessage(error)}`)
    } finally {
      setDataManaging(false)
    }
  }

  function requestRestoreDataBackup() {
    if (dataManaging) {
      return
    }

    backupInputRef.current?.click()
  }

  async function handleBackupRestoreUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || dataManaging) {
      return
    }

    const confirmed = window.confirm('恢复备份会覆盖当前模板、词库和程序设置。程序会先自动备份当前数据，确认继续吗？')
    if (!confirmed) {
      setStatus('已取消恢复备份。')
      return
    }

    setDataManaging(true)
    try {
      const result = await restoreDataBackup(file)
      window.localStorage.removeItem(workspaceStorageKey)
      setTabs([])
      setActiveTabId(null)
      setPreviewTemplateId(null)
      await bootstrap()
      setStatus(`已恢复备份：${result.sourceFileName}。恢复前快照：${result.preRestoreBackupFileName}`)
      queueActivity(`已恢复备份：${result.sourceFileName}`)
    } catch (error) {
      setStatus(`恢复备份失败：${getErrorMessage(error)}`)
    } finally {
      setDataManaging(false)
    }
  }

  async function openLocalDataDirectory() {
    if (dataManaging) {
      return
    }

    setDataManaging(true)
    try {
      await openDataDirectory()
      setStatus('已打开备份目录。')
    } catch (error) {
      setStatus(`打开备份目录失败：${getErrorMessage(error)}`)
    } finally {
      setDataManaging(false)
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
    openTab(createEditorTab(next, { templateId: null, origin: 'blank' }))
    setStatus('已新建空白草稿。')
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
      const source = await file.text()
      const imported = importLabelDocument(source, file.name)
      openTab(createEditorTab(imported.document, { templateId: null, origin: 'imported' }))
      queueActivity(`已导入：${imported.document.name}`)
      setStatus(
        imported.warnings.length > 0
          ? `已导入：${imported.document.name} · ${imported.warnings.join('；')}`
          : `已导入：${imported.document.name}`,
      )
    } catch (error) {
      setStatus(`导入失败：${getErrorMessage(error)}`)
    }
  }

  function importLabelDocument(source: string, fileName: string) {
    const trimmed = source.trimStart()
    if (trimmed.startsWith('{')) {
      const parsed = JSON.parse(source) as { document?: LabelDocument; name?: string; kind?: string }
      const importedDocument = parsed.document ? normalizeDocument(parsed.document) : parseSerializedDocument(source)
      if (!importedDocument) {
        throw new Error('YiboLabel 导出文件结构无法解析。')
      }

      const baseName = parsed.name?.trim() || importedDocument.name?.trim() || fileName.replace(/\.[^.]+$/, '').trim() || '导入标签'
      return {
        document: normalizeDocument({
          ...importedDocument,
          name: baseName,
        }),
        warnings: parsed.kind === 'yibolabel-template-export' ? [] : ['已按 YiboLabel JSON 结构导入'],
      }
    }

    return importLegacyTemplate(source, fileName, {
      minDocumentSizeMm,
      minElementSizeMm,
      defaultFontFamily,
      createBlankDocument,
      createElement,
      normalizeDocument,
      normalizeRotation,
      clamp,
      createId,
    })
  }

  function addNewElement(type: LabelElement['type']) {
    const element = createElement(type, documentRef.current)
    updateDocument((current) => ({
      ...current,
      elements: reindexElements([...current.elements, element]),
    }))
    setActiveSelection([element.id])
    setStatus(`已新增元素：${element.name ?? getDefaultElementName(element.type)}`)
  }

  function updateSelectedElement(patch: Partial<LabelElement>) {
    if (!selectedElement) {
      return
    }

    if (selectedElement.locked && ('x' in patch || 'y' in patch || 'width' in patch || 'height' in patch || 'rotation' in patch)) {
      setStatus(`元素已锁定，不能调整位置、尺寸或旋转：${selectedElement.name ?? getDefaultElementName(selectedElement.type)}`)
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

  function setCopies(nextCopies: number) {
    setDocumentField('copies', nextCopies)
  }

  function adjustCopies(delta: number) {
    setCopies(labelDocument.copies + delta)
  }

  function handlePrinterChange(devicePath: string) {
    updateDocument((current) => ({
      ...current,
      printerDevicePath: devicePath,
    }))
  }

  function updateCalibrationField<K extends keyof LabelDocument>(field: K, value: LabelDocument[K]) {
    updateDocument((current) => ({
      ...current,
      [field]: value,
      printCalibrationState:
        current.calibrationPrinterDevicePath && current.calibrationPrinterDevicePath === (current.printerDevicePath ?? null)
          ? 'unconfirmed'
          : current.printCalibrationState ?? 'unset',
    }))
  }

  async function saveCalibration(mode: 'update-current' | 'save-as-new' | 'rename-current') {
    if (!currentPrinter) {
      return
    }

    try {
      const defaultLabel =
        mode === 'save-as-new'
          ? `${labelDocument.printCalibrationLabel?.trim() || '当前打印机校准'} 副本`
          : labelDocument.printCalibrationLabel?.trim() || '当前打印机校准'
      const label = window.prompt('校准方案标签', defaultLabel)?.trim()
      if (!label) {
        return
      }

      const saved = await savePrinterCalibration({
        id:
          mode !== 'save-as-new' && labelDocument.calibrationPrinterDevicePath === currentPrinter.devicePath
            ? labelDocument.calibrationProfileId ?? null
            : null,
        devicePath: currentPrinter.devicePath,
        printerName: currentPrinter.displayName,
        isDefault:
          mode !== 'save-as-new'
          && labelDocument.calibrationPrinterDevicePath === currentPrinter.devicePath
          && (
            printerCalibrationProfiles.find((profile) => profile.id === labelDocument.calibrationProfileId)?.isDefault
            ?? false
          ),
        state: 'calibrated',
        label,
        printOffsetXMm: labelDocument.printOffsetXMm,
        printOffsetYMm: labelDocument.printOffsetYMm,
        printRotation: labelDocument.printRotation,
        darkness: labelDocument.darkness,
        printInvert: labelDocument.printInvert,
      })
      setPrinterCalibrationProfiles((current) => {
        const next = current.some((profile) => profile.id === saved.id)
          ? current.map((profile) => (profile.id === saved.id ? saved : profile))
          : [saved, ...current]
        return sortCalibrationProfiles(next)
      })
      applyPrinterCalibration(saved, currentPrinter.displayName, currentPrinter.devicePath)
      setStatus(
        mode === 'rename-current'
          ? `已更新 ${currentPrinter.displayName} 的校准方案：${label}`
          : mode === 'save-as-new'
            ? `已另存 ${currentPrinter.displayName} 的新校准方案：${label}`
            : `已保存 ${currentPrinter.displayName} 的校准方案：${label}`,
      )
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  function resetCalibration() {
    updateDocument((current) => ({
      ...current,
      printRotation: 0,
      darkness: 8,
      printInvert: false,
      printOffsetXMm: 0,
      printOffsetYMm: 0,
      calibrationPrinterDevicePath: currentPrinter?.devicePath ?? null,
      calibrationProfileId: null,
      printCalibrationState: currentPrinter ? 'default' : 'unset',
      printCalibrationLabel: currentPrinter ? '默认校准' : null,
    }))
    setStatus(currentPrinter ? `已重置 ${currentPrinter.displayName} 为默认校准。` : '已重置当前校准字段。')
  }

  function selectCalibrationProfile(profileId: string) {
    if (!currentPrinter) {
      return
    }

    if (!profileId) {
      resetCalibration()
      return
    }

    const profile = printerCalibrationProfiles.find((item) => item.id === profileId)
    if (!profile) {
      setStatus('未找到所选校准方案。')
      return
    }

    applyPrinterCalibration(profile, currentPrinter.displayName, currentPrinter.devicePath)
    setStatus(`已切换校准方案：${profile.label}`)
  }

  async function setSelectedCalibrationAsDefault() {
    if (!currentPrinter || !labelDocument.calibrationProfileId) {
      return
    }

    const profile = printerCalibrationProfiles.find((item) => item.id === labelDocument.calibrationProfileId)
    if (!profile || profile.isDefault) {
      return
    }

    try {
      const saved = await savePrinterCalibration({
        id: profile.id,
        devicePath: profile.devicePath,
        printerName: profile.printerName,
        isDefault: true,
        state: profile.state,
        label: profile.label,
        printOffsetXMm: labelDocument.printOffsetXMm,
        printOffsetYMm: labelDocument.printOffsetYMm,
        printRotation: labelDocument.printRotation,
        darkness: labelDocument.darkness,
        printInvert: labelDocument.printInvert,
      })

      setPrinterCalibrationProfiles((current) =>
        sortCalibrationProfiles(
          current.map((item) => {
            if (item.id === saved.id) {
              return saved
            }

            if (item.devicePath === saved.devicePath && item.isDefault) {
              return { ...item, isDefault: false }
            }

            return item
          }),
        ),
      )
      applyPrinterCalibration(saved, currentPrinter.displayName, currentPrinter.devicePath)
      setStatus(`已将 ${saved.label} 设为 ${currentPrinter.displayName} 的默认校准方案。`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function deleteSelectedCalibrationProfile() {
    if (!currentPrinter || !labelDocument.calibrationProfileId) {
      return
    }

    const profile = printerCalibrationProfiles.find((item) => item.id === labelDocument.calibrationProfileId)
    if (!profile) {
      return
    }

    const confirmed = window.confirm(`确认删除校准方案“${profile.label}”？`)
    if (!confirmed) {
      return
    }

    try {
      await deletePrinterCalibration(currentPrinter.devicePath, profile.id)
      const remainingProfiles = printerCalibrationProfiles.filter((item) => item.id !== profile.id)
      setPrinterCalibrationProfiles(remainingProfiles)
      if (remainingProfiles.length > 0) {
        applyPrinterCalibration(remainingProfiles[0], currentPrinter.displayName, currentPrinter.devicePath)
        setStatus(`已删除校准方案：${profile.label}，并切换到 ${remainingProfiles[0].label}`)
      } else {
        resetCalibration()
        setStatus(`已删除校准方案：${profile.label}`)
      }
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  function applyDocumentSpecPreset(preset: DocumentSpecPresetSummary) {
    updateDocument((current) => ({
      ...current,
      widthMm: preset.widthMm,
      heightMm: preset.heightMm,
      gapMm: preset.gapMm,
      sourceSpecId: preset.id,
      sourceSpecName: preset.name,
    }))
    setStatus(`已套用规格预设：${preset.name}`)
  }

  async function saveCurrentDocumentSpecAsPreset(options?: { suggestedName?: string }) {
    const suggestedName = options?.suggestedName ?? (labelDocument.sourceSpecName?.trim() || `${labelDocument.widthMm} x ${labelDocument.heightMm} mm`)
    const name = window.prompt('规格预设名称', suggestedName)?.trim()
    if (!name) {
      return
    }

    try {
      const created = await createDocumentSpecPreset({
        name,
        widthMm: labelDocument.widthMm,
        heightMm: labelDocument.heightMm,
        gapMm: labelDocument.gapMm,
        notes: null,
      })
      await refreshDocumentSpecPresets()
      updateDocument((current) => ({
        ...current,
        sourceSpecId: created.id,
        sourceSpecName: created.name,
      }), { pushHistory: false })
      setStatus(`已保存规格预设：${created.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function saveDocumentSpecPresetEdit(preset: DocumentSpecPresetSummary, nextName: string, nextNotes: string) {
    const name = nextName.trim()
    if (!name) {
      setStatus('规格预设名称不能为空。')
      return
    }

    const notes = nextNotes.trim()
    try {
      await updateDocumentSpecPreset(preset.id, {
        name,
        notes: notes || null,
        isHidden: preset.isHidden,
        isArchived: preset.isArchived,
      })
      await refreshDocumentSpecPresets()
      if (labelDocument.sourceSpecId === preset.id) {
        updateDocument((current) => ({
          ...current,
          sourceSpecName: name,
        }), { pushHistory: false })
      }
      setStatus(`已更新规格预设：${name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function toggleArchiveDocumentSpecPreset(preset: DocumentSpecPresetSummary) {
    try {
      await updateDocumentSpecPreset(preset.id, {
        name: preset.name,
        notes: preset.notes ?? null,
        isHidden: preset.isHidden,
        isArchived: !preset.isArchived,
      })
      await refreshDocumentSpecPresets()
      setStatus(`${preset.isArchived ? '已取消归档' : '已归档'}规格预设：${preset.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function toggleHiddenDocumentSpecPreset(preset: DocumentSpecPresetSummary) {
    try {
      await updateDocumentSpecPreset(preset.id, {
        name: preset.name,
        notes: preset.notes ?? null,
        isHidden: !preset.isHidden,
        isArchived: preset.isArchived,
      })
      await refreshDocumentSpecPresets()
      setStatus(`${preset.isHidden ? '已取消隐藏' : '已隐藏'}规格预设：${preset.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  async function removeDocumentSpecPreset(preset: DocumentSpecPresetSummary) {
    if (preset.referenceCount > 0) {
      setStatus(`规格“${preset.name}”已有 ${preset.referenceCount} 个模板使用，不能直接删除。`)
      return
    }

    const confirmed = window.confirm(`确认删除规格预设“${preset.name}”？`)
    if (!confirmed) {
      return
    }

    try {
      await deleteDocumentSpecPreset(preset.id)
      await refreshDocumentSpecPresets()
      if (labelDocument.sourceSpecId === preset.id) {
        updateDocument((current) => ({
          ...current,
          sourceSpecId: null,
          sourceSpecName: current.sourceSpecName ?? preset.name,
        }), { pushHistory: false })
      }
      setStatus(`已删除规格预设：${preset.name}`)
    } catch (error) {
      setStatus(getErrorMessage(error))
    }
  }

  function deleteSelectedElements() {
    if (selectedElementIds.length === 0) {
      return
    }

    const removableIds = selectedElementIds.filter((id) => !labelDocument.elements.find((element) => element.id === id)?.locked)
    if (removableIds.length === 0) {
      setStatus('所选元素都已锁定，不能删除。')
      return
    }

    const removedCount = removableIds.length
    const removableSet = new Set(removableIds)
    const orderedElements = sortElementsByListOrder(labelDocument.elements)
    const firstRemovedIndex = orderedElements.findIndex((element) => removableSet.has(element.id))
    const remainingOrderedElements = orderedElements.filter((element) => !removableSet.has(element.id))
    const fallbackIndex = firstRemovedIndex < 0 ? -1 : Math.min(firstRemovedIndex, Math.max(remainingOrderedElements.length - 1, 0))
    const nextSelection =
      remainingOrderedElements.length === 0 || fallbackIndex < 0
        ? []
        : [remainingOrderedElements[fallbackIndex]?.id ?? remainingOrderedElements.at(-1)?.id].filter(Boolean) as string[]

    updateDocument((current) => ({
      ...current,
      elements: reindexElements(current.elements.filter((element) => !removableSet.has(element.id))),
    }))
    setInlineEditorState((current) => (current && removableSet.has(current.elementId) ? null : current))
    setActiveSelection(nextSelection)
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

    const movableIds = new Set(selectedElementIds.filter((id) => !labelDocument.elements.find((element) => element.id === id)?.locked))
    if (movableIds.size === 0) {
      return
    }

    updateDocument((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        movableIds.has(element.id)
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

  function moveElementInList(movingElementId: string, anchorElementId: string, placement: 'before' | 'after') {
    const movingElement = labelDocument.elements.find((element) => element.id === movingElementId)
    if (!movingElement || movingElementId === anchorElementId) {
      return
    }

    updateDocument((current) => ({
      ...current,
      elements: placement === 'before'
        ? moveElementBefore(current.elements, movingElementId, anchorElementId)
        : moveElementAfter(current.elements, movingElementId, anchorElementId),
    }))
    setActiveSelection([movingElementId])
    setStatus(`已调整元素顺序：${movingElement.name ?? getDefaultElementName(movingElement.type)}`)
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
    setInlineEditorState((current) => (current?.elementId === element.id ? current : null))
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

  function handleElementDoubleClick(element: LabelElement, event: ReactMouseEvent<HTMLDivElement>) {
    event.stopPropagation()
    event.preventDefault()
    if (!isLexiconEnabledElement(element)) {
      return
    }

    const currentValue = element.type === 'text' ? element.text : element.value
    setActiveSelection([element.id])
    setInlineEditorState({
      elementId: element.id,
      draft: currentValue,
      initialValue: currentValue,
    })
  }

  function handleInlineEditorChange(value: string) {
    setInlineEditorState((current) => (current ? { ...current, draft: value } : current))
  }

  function commitInlineEditor() {
    if (!inlineEditorState) {
      return
    }

    const element = labelDocument.elements.find((item) => item.id === inlineEditorState.elementId) ?? null
    if (!isLexiconEnabledElement(element)) {
      setInlineEditorState(null)
      return
    }

    if (inlineEditorState.draft !== inlineEditorState.initialValue) {
      updateElementById(element.id, createContentPatch(element, inlineEditorState.draft))
    }

    setInlineEditorState(null)
  }

  function cancelInlineEditor() {
    setInlineEditorState(null)
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
    <div className={clsx('app-shell', windowIsMaximized && 'window-maximized')}>
      <WorkspaceTopbar
        windowIsMaximized={windowIsMaximized}
        activeSurface={activeSurface}
        activeEditorPanel={activeEditorPanel}
        hasActiveTab={hasActiveTab}
        tabs={tabs}
        activeTabId={activeTabId}
        isTabDirty={isTabDirty}
        recentClosedTabsCount={recentClosedTabs.length}
        appState={appState}
        activeTabDirty={activeTabDirty}
        copies={labelDocument.copies}
        printerDevicePath={labelDocument.printerDevicePath ?? appState?.printers[0]?.devicePath ?? ''}
        currentPrinter={currentPrinter}
        calibrationLabel={printCheckReport.calibrationLabel}
        quickPrintAllowed={printCheckReport.quickPrintAllowed}
        refreshingPrinters={refreshingPrinters}
        saving={saving}
        printing={printing}
        exporting={exporting}
        dataManaging={dataManaging}
        aboutOpen={showAboutDialog}
        onShowEditor={showEditor}
        onCloseTab={closeTab}
        onCreateFreshDocument={createFreshDocument}
        onOpenDocumentSpec={openDocumentSpecPanel}
        onOpenPrintCalibration={openPrintCalibrationPanel}
        onImportDdl={() => ddlInputRef.current?.click()}
        onReopenLastClosedTab={reopenLastClosedTab}
        onPrinterChange={handlePrinterChange}
        onRefreshPrinters={() => void refreshPrinters()}
        onCopiesChange={setCopies}
        onDecreaseCopies={() => adjustCopies(-1)}
        onIncreaseCopies={() => adjustCopies(1)}
        onSaveCurrentTemplate={() => void saveCurrentTemplate()}
        onSaveAsTemplate={() => void saveAsTemplate()}
        onShowExportDialog={() => setShowExportDialog(true)}
        onBackupAllData={() => void backupAllData()}
        onRestoreDataBackup={requestRestoreDataBackup}
        onOpenDataDirectory={() => void openLocalDataDirectory()}
        onOpenAbout={() => setShowAboutDialog(true)}
        onOpenPrintCheck={openPrintCheckSurface}
        onPrintCurrent={() => void printCurrent()}
        onRequestAppClose={requestAppClose}
      />

      <main className={clsx('workspace', activeSurface === 'print-check' && 'print-check-mode', sidebarTab === 'templates' && activeSurface === 'editor' && 'template-preview-mode')}>
        {activeSurface === 'print-check' ? (
          <PrintCheckSurface
            labelDocument={labelDocument}
            currentPrinter={currentPrinter}
            activeTabDirty={activeTabDirty}
            report={printCheckReport}
            overlapSummary={visibleOverlapSummary}
            saving={saving}
            printing={printing}
            onBackToEditor={() => showEditor()}
            onOpenDocumentSpec={openDocumentSpecPanel}
            onOpenPrintCalibration={openPrintCalibrationPanel}
            onSave={() => void saveCurrentTemplate()}
            onPrint={() => void printCurrent({ markChecked: true })}
          />
        ) : (
          <>
            <TemplateEditorSidebar
              activeTab={sidebarTab}
              hasActiveTab={hasActiveTab}
              selectedElementIds={selectedElementIds}
              bindableSelectedElements={bindableSelectedElements}
              sortedElements={listOrderedElements}
              templates={templates}
              visibleTemplates={visibleTemplates}
              templateQuery={templateQuery}
              previewTemplateId={previewTemplateId}
              openedTemplateState={openedTemplateState}
              lexiconGroups={lexiconGroups}
              lexiconLibrary={lexiconLibrary}
              activeGroupId={activeSidebarGroupId}
              lastLexiconAction={currentTabLexiconAction}
              bindingOverlayEnabled={bindingOverlayEnabled}
              bindingOverlayScope={bindingOverlayScope}
              onSidebarTabChange={handleSidebarTabChange}
              onActiveGroupChange={setActiveSidebarGroupId}
              onBindingOverlayEnabledChange={setBindingOverlayEnabled}
              onBindingOverlayScopeChange={setBindingOverlayScope}
              onTemplateQueryChange={setTemplateQuery}
              onAddText={() => addNewElement('text')}
              onAddBarcode={() => addNewElement('barcode')}
              onAddQrCode={() => addNewElement('qrcode')}
              onAddLine={() => addNewElement('line')}
              onAddRectangle={() => addNewElement('rectangle')}
              onAddImage={() => fileInputRef.current?.click()}
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
              onMoveElement={moveElementInList}
              onToggleGroupForElement={toggleLexiconGroupForElement}
              onBindGroupToElement={handleLexiconBindGroupToElement}
              onUnbindGroupFromElement={handleLexiconUnbindGroupFromElement}
              onApplyEntryToElement={handleLexiconApplyEntryToElement}
              onUndoLastLexiconAction={undoLastLexiconSidebarAction}
              onCreateGroup={() => void createSidebarLexiconGroup()}
              onRenameGroup={(groupId) => void renameSidebarLexiconGroup(groupId)}
              onDeleteGroup={(groupId) => void deleteSidebarLexiconGroup(groupId)}
              onMoveGroup={(movingGroupId, anchorGroupId, placement) => void moveSidebarLexiconGroup(movingGroupId, anchorGroupId, placement)}
              onCreateEntry={(groupId) => void createSidebarLexiconEntry(groupId)}
              onRenameEntry={(groupId, entryId) => void renameSidebarLexiconEntry(groupId, entryId)}
              onDeleteEntry={(groupId, entryId) => void deleteSidebarLexiconEntry(groupId, entryId)}
              onMoveEntry={(sourceGroupId, movingEntryId, targetGroupId, anchorEntryId, placement) => void moveSidebarLexiconEntry(sourceGroupId, movingEntryId, targetGroupId, anchorEntryId, placement)}
              onMoveTemplate={(movingTemplateId, anchorTemplateId, placement) => void moveSidebarTemplate(movingTemplateId, anchorTemplateId, placement)}
              onSelectPreviewTemplate={selectPreviewTemplate}
              onOpenTemplate={(templateId) => void loadTemplate(templateId)}
              onDuplicateTemplate={(template) => void duplicateTemplate(template)}
              onRenameTemplate={(template) => void renameTemplate(template)}
              onDeleteTemplate={(template) => void deleteTemplate(template)}
            />

            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleImageUpload} />

            {sidebarTab === 'templates' ? (
              <TemplatePreviewPanel
                previewTemplateId={previewTemplateId}
                previewTemplate={previewTemplateRecord}
                loading={previewTemplateLoading}
                openedState={previewTemplateOpenState}
                onEditTemplate={(templateId) => {
                  void loadTemplate(templateId, { forceSidebarTab: 'elements' })
                }}
              />
            ) : (
              <EditorCanvasPanel
                hasActiveTab={hasActiveTab}
                labelDocument={labelDocument}
                activeTemplateId={activeTemplateId}
                status={status}
                history={history}
                selectedElementIds={selectedElementIds}
                exporting={exporting}
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
                bindingOverlayElements={bindingOverlayElements}
                inlineEditingElement={inlineEditingElement}
                inlineEditingValue={inlineEditorState?.draft ?? ''}
                recentClosedTabsCount={recentClosedTabs.length}
                onUndo={undo}
                onRedo={redo}
                onDuplicateSelected={duplicateSelectedElements}
                onDeleteSelected={deleteSelectedElements}
                onCanvasWrapPointerDown={handleCanvasWrapPointerDown}
                onCanvasWheel={handleCanvasWheel}
                onCanvasPointerDown={handleCanvasPointerDown}
                onElementPointerDown={handleElementPointerDown}
                onElementDoubleClick={handleElementDoubleClick}
                onResizeHandlePointerDown={handleResizeHandlePointerDown}
                onRotatePointerDown={handleRotatePointerDown}
                onInlineEditorChange={handleInlineEditorChange}
                onInlineEditorCommit={commitInlineEditor}
                onInlineEditorCancel={cancelInlineEditor}
                onCreateFreshDocument={createFreshDocument}
                onImportDdl={() => ddlInputRef.current?.click()}
                onReopenLastClosedTab={reopenLastClosedTab}
                onBindGroupToElement={handleLexiconBindGroupToElement}
                onApplyEntryToElement={handleLexiconApplyEntryToElement}
              />
            )}

            {sidebarTab === 'templates' ? null : activeEditorPanel === 'document-spec' ? (
              <DocumentSpecPanel
                open
                labelDocument={labelDocument}
                specPresets={documentSpecPresets}
                activeSourcePreset={activeSourcePreset}
                sourcePresetChanged={sourcePresetChanged}
                onDocumentFieldChange={setDocumentField}
                onApplyPreset={applyDocumentSpecPreset}
                onSaveAsPreset={() => void saveCurrentDocumentSpecAsPreset()}
                onSavePresetEdit={(preset, nextName, nextNotes) => void saveDocumentSpecPresetEdit(preset, nextName, nextNotes)}
                onArchivePreset={(preset) => void toggleArchiveDocumentSpecPreset(preset)}
                onToggleHiddenPreset={(preset) => void toggleHiddenDocumentSpecPreset(preset)}
                onDeletePreset={(preset) => void removeDocumentSpecPreset(preset)}
              />
            ) : activeEditorPanel === 'print-calibration' ? (
              <PrintCalibrationPanel
                open
                labelDocument={labelDocument}
                currentPrinter={currentPrinter}
                calibrationLabel={printCheckReport.calibrationLabel}
                calibrationProfiles={printerCalibrationProfiles}
                refreshingPrinters={refreshingPrinters}
                onDocumentFieldChange={updateCalibrationField}
                onCalibrationProfileChange={selectCalibrationProfile}
                onRefreshPrinters={() => void refreshPrinters()}
                onMarkCalibrationSaved={() => void saveCalibration('update-current')}
                onSaveCalibrationAsNew={() => void saveCalibration('save-as-new')}
                onRenameCalibration={() => void saveCalibration('rename-current')}
                onSetDefaultCalibration={() => void setSelectedCalibrationAsDefault()}
                onDeleteCalibration={() => void deleteSelectedCalibrationProfile()}
                onResetCalibration={resetCalibration}
                onTestPrint={() => void printCurrent({ statusLabel: '测试打印已发送到设备。' })}
              />
            ) : (
              <aside className="inspector object-panel">
                {!hasActiveTab ? (
                  <p className="empty-note">打开一个标签后，这里会显示元素属性和精确调整项。</p>
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
            )}
          </>
        )}
      </main>

      <input ref={ddlInputRef} type="file" accept=".ddl,.xml,.json,.yblabel.json,text/xml,application/json" hidden onChange={handleDdlUpload} />
      <input ref={backupInputRef} type="file" accept=".zip,.yibolabel-backup,application/zip" hidden onChange={handleBackupRestoreUpload} />

      <AboutDialog
        open={showAboutDialog}
        appVersion={appState?.appVersion ?? fallbackAppVersion}
        githubUrl={githubUrl}
        onClose={() => setShowAboutDialog(false)}
      />

      <ExportDialog
        open={showExportDialog && hasActiveTab}
        exporting={exporting}
        options={exportOptions}
        onOptionsChange={setExportOptions}
        onClose={() => {
          if (!exporting) {
            setShowExportDialog(false)
          }
        }}
        onExport={() => void exportCurrent()}
      />

      <UnsavedChangesDialog
        open={unsavedDialog !== null}
        title={unsavedDialog?.title ?? ''}
        body={unsavedDialog?.body ?? ''}
        saving={saving}
        saveLabel={unsavedDialog?.saveLabel}
        onSave={() => void handleUnsavedDialogSave()}
        onDiscard={handleUnsavedDialogDiscard}
        onCancel={handleUnsavedDialogCancel}
      />

      <PendingSavesDialog
        open={pendingSavesOpen}
        items={pendingSaveItems}
        saving={saving}
        onSaveAll={() => void handleSaveAllBeforeExit()}
        onReviewOneByOne={() => startExitReview(dirtyTabs.map((tab) => tab.id))}
        onDiscardAndExit={completeAppClose}
        onCancel={() => {
          setPendingSavesOpen(false)
          abortPendingHostClose()
        }}
      />
    </div>
  )
}

function buildExportFileName(name: string, format: ExportDialogOptions['format']) {
  const baseName = sanitizeSuggestedFileName(name || '未命名标签')
  const extension = format === 'template'
    ? '.yblabel.json'
    : format === 'png'
      ? '.png'
      : format === 'jpg'
        ? '.jpg'
        : '.pdf'
  return baseName.endsWith(extension) ? baseName : `${baseName}${extension}`
}

function sanitizeSuggestedFileName(name: string) {
  const invalidCharacters = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
  const sanitized = [...name]
    .map((character) => invalidCharacters.has(character) || character.charCodeAt(0) < 32 ? '_' : character)
    .join('')
    .trim()
  return sanitized || '未命名标签'
}

function getExportFormatLabel(format: ExportDialogOptions['format']) {
  return format === 'template'
    ? '本地模板'
    : format === 'png'
      ? 'PNG'
      : format === 'jpg'
        ? 'JPG'
        : 'PDF'
}

function buildTemplateExportJson(labelDocument: LabelDocument) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      kind: 'yibolabel-template-export',
      exportedAt: new Date().toISOString(),
      name: labelDocument.name,
      document: labelDocument,
    },
    null,
    2,
  )
}

function dataUrlToBase64(dataUrl: string) {
  const marker = 'base64,'
  const markerIndex = dataUrl.indexOf(marker)
  if (markerIndex < 0) {
    throw new Error('图片导出数据格式异常。')
  }

  return dataUrl.slice(markerIndex + marker.length)
}

function waitForPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve())
    })
  })
}
