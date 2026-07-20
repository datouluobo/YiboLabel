import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronsDown,
  ChevronsUp,
  Copy,
  Eye,
  EyeOff,
  GripVertical,
  ImagePlus,
  Layers,
  Link2,
  LockKeyhole,
  Minus,
  Pencil,
  Plus,
  QrCode,
  RotateCcw,
  ScanBarcode,
  Square,
  Trash2,
  Type,
  UnlockKeyhole,
  X,
} from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import type { LexiconActionRecord, LexiconActionSource } from '../domain/lexiconActions'
import { setLexiconDragPayload } from '../domain/lexiconDragPayload'
import { getDefaultElementName, isLexiconEnabledElement } from '../domain/labelDocument'
import { LayerActionButton, ToolButton } from './ElementInspector'
import type { LabelElement, LabelTemplateSummary, LexiconGroupSummary, LexiconLibrary, LexiconSuggestion } from '../types'

type SidebarTab = 'elements' | 'lexicon' | 'templates'
type BindingOverlayScope = 'selected' | 'all'
type SortDragState = { movingId: string; anchorId: string; placement: 'before' | 'after' }
type EntrySortDragState = { movingId: string; sourceGroupId: string; targetGroupId: string; anchorId: string | null; placement: 'before' | 'after' }
type TemplateOpenState = { openCount: number; current: boolean; dirty: boolean }
type LexiconSelection = { kind: 'group'; groupId: string } | { kind: 'entry'; groupId: string; entryId: string }

let transparentDragImage: HTMLImageElement | null = null

type TemplateEditorSidebarProps = {
  activeTab: SidebarTab
  hasActiveTab: boolean
  selectedElementIds: string[]
  bindableSelectedElements: Extract<LabelElement, { type: 'text' | 'barcode' | 'qrcode' }>[]
  sortedElements: LabelElement[]
  templates: LabelTemplateSummary[]
  visibleTemplates: LabelTemplateSummary[]
  templateQuery: string
  previewTemplateId: string | null
  openedTemplateState: Map<string, TemplateOpenState>
  lexiconGroups: LexiconGroupSummary[]
  lexiconLibrary: LexiconLibrary
  activeGroupId: string | null
  lastLexiconAction: LexiconActionRecord | null
  bindingOverlayEnabled: boolean
  bindingOverlayScope: BindingOverlayScope
  onSidebarTabChange: (tab: SidebarTab) => void
  onActiveGroupChange: (groupId: string | null) => void
  onBindingOverlayEnabledChange: (enabled: boolean) => void
  onBindingOverlayScopeChange: (scope: BindingOverlayScope) => void
  onTemplateQueryChange: (value: string) => void
  onAddText: () => void
  onAddBarcode: () => void
  onAddQrCode: () => void
  onAddLine: () => void
  onAddRectangle: () => void
  onAddImage: () => void
  onReorderFront: () => void
  onReorderForward: () => void
  onReorderBackward: () => void
  onReorderBack: () => void
  onSelectLayer: (elementId: string, additive: boolean) => void
  onToggleHidden: (elementId: string) => void
  onToggleLock: (elementId: string) => void
  onMoveElement: (movingElementId: string, anchorElementId: string, placement: 'before' | 'after') => void
  onToggleGroupForElement: (elementId: string, groupId: string) => void
  onBindGroupToElement: (elementId: string, groupId: string, source?: LexiconActionSource) => void
  onUnbindGroupFromElement: (elementId: string, groupId: string, source?: LexiconActionSource) => void
  onApplyEntryToElement: (elementId: string, text: string, groupId: string | null, source?: LexiconActionSource) => void
  onUndoLastLexiconAction: () => void
  onCreateGroup: () => void
  onRenameGroup: (groupId: string) => void
  onDeleteGroup: (groupId: string) => void
  onMoveGroup: (movingGroupId: string, anchorGroupId: string, placement: 'before' | 'after') => void
  onCreateEntry: (groupId: string) => void
  onRenameEntry: (groupId: string, entryId: string) => void
  onDeleteEntry: (groupId: string, entryId: string) => void
  onMoveEntry: (sourceGroupId: string, movingEntryId: string, targetGroupId: string, anchorEntryId: string | null, placement: 'before' | 'after') => void
  onMoveTemplate: (movingTemplateId: string, anchorTemplateId: string, placement: 'before' | 'after') => void
  onSelectPreviewTemplate: (templateId: string) => void
  onOpenTemplate: (templateId: string) => void
  onDuplicateTemplate: (template: LabelTemplateSummary) => void
  onRenameTemplate: (template: LabelTemplateSummary) => void
  onDeleteTemplate: (template: LabelTemplateSummary) => void
}

export function TemplateEditorSidebar({
  activeTab,
  hasActiveTab,
  selectedElementIds,
  bindableSelectedElements,
  sortedElements,
  templates,
  visibleTemplates,
  templateQuery,
  previewTemplateId,
  openedTemplateState,
  lexiconGroups,
  lexiconLibrary,
  activeGroupId,
  lastLexiconAction,
  bindingOverlayEnabled,
  bindingOverlayScope,
  onSidebarTabChange,
  onActiveGroupChange,
  onBindingOverlayEnabledChange,
  onBindingOverlayScopeChange,
  onTemplateQueryChange,
  onAddText,
  onAddBarcode,
  onAddQrCode,
  onAddLine,
  onAddRectangle,
  onAddImage,
  onReorderFront,
  onReorderForward,
  onReorderBackward,
  onReorderBack,
  onSelectLayer,
  onToggleHidden,
  onToggleLock,
  onMoveElement,
  onToggleGroupForElement,
  onBindGroupToElement,
  onUnbindGroupFromElement,
  onApplyEntryToElement,
  onUndoLastLexiconAction,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onMoveGroup,
  onCreateEntry,
  onRenameEntry,
  onDeleteEntry,
  onMoveEntry,
  onMoveTemplate,
  onSelectPreviewTemplate,
  onOpenTemplate,
  onDuplicateTemplate,
  onRenameTemplate,
  onDeleteTemplate,
}: TemplateEditorSidebarProps) {
  const [entryQuery, setEntryQuery] = useState('')
  const [lexiconSelection, setLexiconSelection] = useState<LexiconSelection | null>(null)
  const [expandedGroupIds, setExpandedGroupIds] = useState<string[]>([])
  const [bindingPopoverElementId, setBindingPopoverElementId] = useState<string | null>(null)
  const [bindingPopoverPosition, setBindingPopoverPosition] = useState<{ top: number; left: number } | null>(null)
  const [dropTargetLayerId, setDropTargetLayerId] = useState<string | null>(null)
  const [dragState, setDragState] = useState<{ movingId: string; anchorId: string; placement: 'before' | 'after' } | null>(null)
  const [groupSortDrag, setGroupSortDrag] = useState<SortDragState | null>(null)
  const [entrySortDrag, setEntrySortDrag] = useState<EntrySortDragState | null>(null)
  const [templateSortDrag, setTemplateSortDrag] = useState<SortDragState | null>(null)
  const [primaryActionLabel, setPrimaryActionLabel] = useState('绑定分组')
  const [undoActionLabel, setUndoActionLabel] = useState('恢复绑定')
  const pointerDragRef = useRef<{ pointerId: number; movingId: string } | null>(null)
  const bindingPopoverRef = useRef<HTMLDivElement | null>(null)
  const bindingButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const singleBindableElement = bindableSelectedElements.length === 1 ? bindableSelectedElements[0] : null
  const hasBindingContext = singleBindableElement !== null
  const selectedElementGroupIds = new Set(singleBindableElement?.lexiconGroupIds ?? [])

  const setNextDragState = (next: { movingId: string; anchorId: string; placement: 'before' | 'after' } | null) => {
    setDragState(next)
  }

  const beginSidebarSortDrag = (
    event: ReactDragEvent<HTMLButtonElement>,
    kind: 'group' | 'entry' | 'template',
    nextState: SortDragState | EntrySortDragState,
  ) => {
    document.body.classList.add('is-sidebar-sorting')
    if (!transparentDragImage) {
      transparentDragImage = new Image()
      transparentDragImage.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
    }
    event.dataTransfer.setDragImage(transparentDragImage, 0, 0)

    if (kind === 'group') {
      setGroupSortDrag(nextState as SortDragState)
      return
    }

    if (kind === 'entry') {
      setEntrySortDrag(nextState as EntrySortDragState)
      return
    }

    setTemplateSortDrag(nextState as SortDragState)
  }

  const endSidebarSortDrag = (kind: 'group' | 'entry' | 'template') => {
    document.body.classList.remove('is-sidebar-sorting')

    if (kind === 'group') {
      setGroupSortDrag(null)
      return
    }

    if (kind === 'entry') {
      setEntrySortDrag(null)
      return
    }

    setTemplateSortDrag(null)
  }

  useEffect(() => () => {
    document.body.classList.remove('is-sidebar-sorting')
  }, [])

  const updateDragStateFromPoint = (_clientX: number, clientY: number) => {
    if (!pointerDragRef.current) {
      return
    }

    const rows = [...document.querySelectorAll<HTMLElement>('[data-layer-row-id]')].filter(
      (row) => row.dataset.layerRowId !== pointerDragRef.current?.movingId,
    )
    if (rows.length === 0) {
      return
    }

    let targetRow =
      rows.find((row) => {
        const bounds = row.getBoundingClientRect()
        return clientY >= bounds.top && clientY <= bounds.bottom
      }) ?? null

    if (!targetRow) {
      targetRow =
        rows.reduce<HTMLElement | null>((closest, row) => {
          const bounds = row.getBoundingClientRect()
          const rowCenter = bounds.top + bounds.height / 2
          if (!closest) {
            return row
          }

          const closestBounds = closest.getBoundingClientRect()
          const closestCenter = closestBounds.top + closestBounds.height / 2
          return Math.abs(clientY - rowCenter) < Math.abs(clientY - closestCenter) ? row : closest
        }, null)
    }

    if (!targetRow) {
      return
    }

    const elementId = targetRow.dataset.layerRowId
    if (!elementId) {
      return
    }

    const bounds = targetRow.getBoundingClientRect()
    const placement = clientY <= bounds.top + bounds.height / 2 ? 'before' : 'after'
    setNextDragState({ movingId: pointerDragRef.current.movingId, anchorId: elementId, placement })
  }

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!pointerDragRef.current || event.pointerId !== pointerDragRef.current.pointerId) {
        return
      }

      event.preventDefault()
      updateDragStateFromPoint(event.clientX, event.clientY)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerDragRef.current || event.pointerId !== pointerDragRef.current.pointerId) {
        return
      }

      const currentDragState = dragState
      if (currentDragState && currentDragState.movingId !== currentDragState.anchorId) {
        onMoveElement(currentDragState.movingId, currentDragState.anchorId, currentDragState.placement)
      }

      pointerDragRef.current = null
      setNextDragState(null)
      document.body.classList.remove('is-layer-dragging')
    }

    window.addEventListener('pointermove', handlePointerMove, { passive: false })
    window.addEventListener('pointerup', handlePointerUp)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [dragState, onMoveElement])

  useEffect(() => {
    if (!bindingPopoverElementId) {
      return
    }

    const updatePosition = () => {
      const button = bindingButtonRefs.current[bindingPopoverElementId]
      if (!button) {
        return
      }

      const bounds = button.getBoundingClientRect()
      const popoverWidth = 280
      const preferredLeft = bounds.right + 8
      const maxLeft = Math.max(12, window.innerWidth - popoverWidth - 12)
      setBindingPopoverPosition({
        top: Math.max(12, Math.min(bounds.top - 4, window.innerHeight - 320)),
        left: Math.max(12, Math.min(preferredLeft, maxLeft)),
      })
    }

    updatePosition()

    const handlePointerDown = (event: PointerEvent) => {
      if (!bindingPopoverRef.current?.contains(event.target as Node)) {
        setBindingPopoverElementId(null)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setBindingPopoverElementId(null)
      }
    }

    const handleViewportChange = () => updatePosition()

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', handleViewportChange)
    window.addEventListener('scroll', handleViewportChange, true)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', handleViewportChange)
      window.removeEventListener('scroll', handleViewportChange, true)
    }
  }, [bindingPopoverElementId])

  const activeLexiconGroups = useMemo(() => lexiconLibrary.lexicons.flatMap((lexicon) => lexicon.groups), [lexiconLibrary.lexicons])

  const currentGroup = useMemo(() => {
    if (!activeGroupId) {
      return null
    }

    return activeLexiconGroups.find((group) => group.id === activeGroupId) ?? null
  }, [activeGroupId, activeLexiconGroups])

  const filteredLexiconGroups = useMemo(() => {
    const query = entryQuery.trim().toLowerCase()
    return activeLexiconGroups
      .map((group) => {
        const groupMatches = query.length > 0 && group.name.toLowerCase().includes(query)
        return {
          group,
          entries: query.length === 0 || groupMatches
            ? group.entries
            : group.entries.filter((entry) => entry.text.toLowerCase().includes(query)),
          groupMatches,
        }
      })
      .filter(({ entries, groupMatches }) => query.length === 0 || groupMatches || entries.length > 0)
  }, [activeLexiconGroups, entryQuery])

  const hasEntryQuery = entryQuery.trim().length > 0

  const getSortPlacement = (event: ReactDragEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return event.clientY <= bounds.top + bounds.height / 2 ? 'before' : 'after'
  }

  const readPlainDragPayload = (event: ReactDragEvent<HTMLElement>) => event.dataTransfer.getData('text/plain')

  const hasLexiconDragPayload = (event: ReactDragEvent<HTMLElement>) => {
    const types = Array.from(event.dataTransfer.types)
    return types.includes('application/x-yibolabel-group-id')
      || types.includes('application/x-yibolabel-entry-text')
      || types.includes('application/x-yibolabel-entry-group-id')
      || types.includes('text/plain')
  }

  const readDraggedGroupId = (event: ReactDragEvent<HTMLElement>) => {
    const directValue = event.dataTransfer.getData('application/x-yibolabel-group-id')
    if (directValue) {
      return directValue
    }

    const plainValue = readPlainDragPayload(event)
    return plainValue.startsWith('yibolabel-group:') ? plainValue.slice('yibolabel-group:'.length) : ''
  }

  const readDraggedEntryText = (event: ReactDragEvent<HTMLElement>) => {
    const directValue = event.dataTransfer.getData('application/x-yibolabel-entry-text')
    if (directValue) {
      return directValue
    }

    const plainValue = readPlainDragPayload(event)
    if (!plainValue.startsWith('yibolabel-entry:')) {
      return ''
    }

    const [, encodedGroupId = '', encodedText = ''] = plainValue.split(':')
    void encodedGroupId
    return decodeURIComponent(encodedText)
  }

  const readDraggedEntryGroupId = (event: ReactDragEvent<HTMLElement>) => {
    const directValue = event.dataTransfer.getData('application/x-yibolabel-entry-group-id')
    if (directValue) {
      return directValue
    }

    const plainValue = readPlainDragPayload(event)
    if (!plainValue.startsWith('yibolabel-entry:')) {
      return null
    }

    const [, encodedGroupId = ''] = plainValue.split(':')
    return decodeURIComponent(encodedGroupId) || null
  }

  const selectedGroupBound = lexiconSelection?.kind === 'group'
    ? selectedElementGroupIds.has(lexiconSelection.groupId)
    : false
  const primaryLexiconAction = singleBindableElement && lexiconSelection
    ? lexiconSelection.kind === 'entry'
      ? { label: '应用条目' as const, kind: 'apply-entry' as const }
      : { label: selectedGroupBound ? '取消绑定' as const : '绑定分组' as const, kind: selectedGroupBound ? 'unbind-group' as const : 'bind-group' as const }
    : null

  const selectedLexiconActionLabel = primaryLexiconAction?.label ?? primaryActionLabel
  const canExecuteSelectedLexiconAction = primaryLexiconAction !== null

  useEffect(() => {
    if (primaryLexiconAction) {
      setPrimaryActionLabel(primaryLexiconAction.label)
    }
  }, [primaryLexiconAction])

  useEffect(() => {
    if (!lastLexiconAction) {
      return
    }

    setUndoActionLabel(
      lastLexiconAction.kind === 'bind-group'
        ? '撤消绑定'
        : lastLexiconAction.kind === 'unbind-group'
          ? '恢复绑定'
          : '撤消应用',
    )
  }, [lastLexiconAction])

  const executeGroupBindAction = (groupId: string) => {
    if (!singleBindableElement) {
      return
    }

    if (selectedElementGroupIds.has(groupId)) {
      onUnbindGroupFromElement(singleBindableElement.id, groupId, 'button')
      return
    }

    onBindGroupToElement(singleBindableElement.id, groupId, 'button')
  }

  const executeEntryApplyAction = (suggestion: LexiconSuggestion) => {
    if (!singleBindableElement) {
      return
    }

    onApplyEntryToElement(singleBindableElement.id, suggestion.text, suggestion.groupId, 'button')
  }

  const runSelectedLexiconAction = () => {
    if (!hasBindingContext || !lexiconSelection) {
      return
    }

    if (lexiconSelection.kind === 'group') {
      executeGroupBindAction(lexiconSelection.groupId)
      return
    }

    const group = activeLexiconGroups.find((item) => item.id === lexiconSelection.groupId)
    const entry = group?.entries.find((item) => item.id === lexiconSelection.entryId)
    if (!group || !entry) {
      return
    }

    executeEntryApplyAction({
      entryId: entry.id,
      text: entry.text,
      groupId: group.id,
      groupName: group.name,
      lexiconId: group.lexiconId,
      lexiconName: '',
    })
  }

  const handleGroupSortOver = (groupId: string, event: ReactDragEvent<HTMLDivElement>) => {
    if (!groupSortDrag || groupSortDrag.movingId === groupId) {
      return
    }

    event.preventDefault()
    setGroupSortDrag({
      movingId: groupSortDrag.movingId,
      anchorId: groupId,
      placement: getSortPlacement(event),
    })
  }

  const handleEntrySortOver = (targetGroupId: string, entryId: string, event: ReactDragEvent<HTMLDivElement>) => {
    if (!entrySortDrag || (entrySortDrag.sourceGroupId === targetGroupId && entrySortDrag.movingId === entryId)) {
      return
    }

    event.preventDefault()
    setEntrySortDrag({
      sourceGroupId: entrySortDrag.sourceGroupId,
      targetGroupId,
      movingId: entrySortDrag.movingId,
      anchorId: entryId,
      placement: getSortPlacement(event),
    })
  }

  const handleEntryGroupSortOver = (targetGroupId: string, event: ReactDragEvent<HTMLElement>) => {
    if (!entrySortDrag || entrySortDrag.sourceGroupId === targetGroupId) {
      return
    }

    event.preventDefault()
    setEntrySortDrag({
      sourceGroupId: entrySortDrag.sourceGroupId,
      targetGroupId,
      movingId: entrySortDrag.movingId,
      anchorId: null,
      placement: 'after',
    })
  }

  const moveDraggedEntry = () => {
    if (!entrySortDrag || (entrySortDrag.sourceGroupId === entrySortDrag.targetGroupId && entrySortDrag.anchorId === entrySortDrag.movingId)) {
      return
    }

    onMoveEntry(entrySortDrag.sourceGroupId, entrySortDrag.movingId, entrySortDrag.targetGroupId, entrySortDrag.anchorId, entrySortDrag.placement)
    endSidebarSortDrag('entry')
  }

  useEffect(() => {
    if (!currentGroup && activeLexiconGroups.length === 0) {
      return
    }

    const autoExpandedIds = entryQuery.trim().length > 0
      ? filteredLexiconGroups.map(({ group }) => group.id)
      : []

    setExpandedGroupIds((current) => [...new Set([...current, ...autoExpandedIds])])
  }, [entryQuery, filteredLexiconGroups])

  useEffect(() => {
    if (!lexiconSelection) {
      return
    }

    if (lexiconSelection.kind === 'group') {
      if (!activeLexiconGroups.some((group) => group.id === lexiconSelection.groupId)) {
        setLexiconSelection(null)
      }
      return
    }

    const group = activeLexiconGroups.find((item) => item.id === lexiconSelection.groupId)
    if (!group || !group.entries.some((entry) => entry.id === lexiconSelection.entryId)) {
      setLexiconSelection(null)
    }
  }, [activeLexiconGroups, lexiconSelection])

  const getElementTypeIcon = (element: LabelElement) => {
    if (element.type === 'text') {
      return <Type size={14} />
    }
    if (element.type === 'barcode') {
      return <ScanBarcode size={14} />
    }
    if (element.type === 'qrcode') {
      return <QrCode size={14} />
    }
    if (element.type === 'line') {
      return <Minus size={14} />
    }
    if (element.type === 'rectangle') {
      return <Square size={14} />
    }
    return <ImagePlus size={14} />
  }

  const getElementPreview = (element: LabelElement) => {
    if (element.type === 'text') {
      return element.text.trim() || getDefaultElementName(element.type)
    }
    if (element.type === 'barcode' || element.type === 'qrcode') {
      return element.value.trim() || getDefaultElementName(element.type)
    }
    return element.name?.trim() || getDefaultElementName(element.type)
  }

  const renderElementsTab = () => (
    <>
      <div className="sidebar-tab-fixed">
        <div className="sidebar-insert-grid">
          <ToolButton icon={<Type size={16} />} label="文本" onClick={onAddText} />
          <ToolButton icon={<ScanBarcode size={16} />} label="条码" onClick={onAddBarcode} />
          <ToolButton icon={<QrCode size={16} />} label="二维码" onClick={onAddQrCode} />
          <ToolButton icon={<Minus size={16} />} label="线条" onClick={onAddLine} />
          <ToolButton icon={<Square size={16} />} label="矩形" onClick={onAddRectangle} />
          <ToolButton icon={<ImagePlus size={16} />} label="图片" onClick={onAddImage} />
        </div>
        <div className="panel-heading sidebar-section-heading">
          <span className="panel-title-with-icon">
            <Layers size={15} />
            元素
          </span>
          <strong>{selectedElementIds.length > 0 ? `${selectedElementIds.length} / ${sortedElements.length}` : sortedElements.length}</strong>
        </div>
        <div className="layer-toolbar" aria-label="元素顺序操作">
          <LayerActionButton icon={<ChevronsUp size={14} />} label="置顶" disabled={selectedElementIds.length === 0} onClick={onReorderFront} />
          <LayerActionButton icon={<ArrowUp size={14} />} label="上移" disabled={selectedElementIds.length === 0} onClick={onReorderForward} />
          <LayerActionButton icon={<ArrowDown size={14} />} label="下移" disabled={selectedElementIds.length === 0} onClick={onReorderBackward} />
          <LayerActionButton icon={<ChevronsDown size={14} />} label="置底" disabled={selectedElementIds.length === 0} onClick={onReorderBack} />
        </div>
      </div>

      <div className="sidebar-tab-scroll layer-list">
        {!hasActiveTab ? (
          <p className="empty-note">当前没有打开的文件，所以也没有可管理的元素。</p>
        ) : sortedElements.length === 0 ? (
          <p className="empty-note">还没有元素。先从上方插入文本、条码、二维码或形状。</p>
        ) : (
          sortedElements.map((element) => {
            const bindable = isLexiconEnabledElement(element)
            const groupCount = bindable ? element.lexiconGroupIds?.length ?? 0 : 0
            const elementGroupIds = new Set(bindable ? element.lexiconGroupIds ?? [] : [])
            const bindingPopoverOpen = bindingPopoverElementId === element.id
            return (
              <div
                key={element.id}
                data-layer-row-id={element.id}
                className={clsx(
                  'layer-row',
                  selectedElementIds.includes(element.id) && 'selected',
                  dropTargetLayerId === element.id && 'group-drop-target',
                  dragState?.anchorId === element.id && `drag-${dragState.placement}`,
                  dragState?.movingId === element.id && 'dragging',
                )}
                onDragOver={(event) => {
                  if (!bindable) {
                    return
                  }

                  if (!hasLexiconDragPayload(event)) {
                    return
                  }

                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                  if (dropTargetLayerId !== element.id) {
                    setDropTargetLayerId(element.id)
                  }
                }}
                onDragLeave={() => {
                  if (dropTargetLayerId === element.id) {
                    setDropTargetLayerId(null)
                  }
                }}
                onDrop={(event) => {
                  if (!bindable) {
                    return
                  }

                  const entryText = readDraggedEntryText(event)
                  const entryGroupId = readDraggedEntryGroupId(event)
                  const groupId = readDraggedGroupId(event)
                  if (!entryText && !groupId) {
                    return
                  }

                  event.preventDefault()
                  setDropTargetLayerId(null)
                  if (entryText) {
                    onApplyEntryToElement(element.id, entryText, entryGroupId, 'drag-drop')
                    return
                  }

                  onBindGroupToElement(element.id, groupId, 'drag-drop')
                }}
              >
                <button
                  className="layer-drag-handle"
                  type="button"
                  aria-label="拖拽调整顺序"
                  title="拖拽调整顺序"
                  onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
                    if (event.button !== 0) {
                      return
                    }

                    event.preventDefault()
                    pointerDragRef.current = { pointerId: event.pointerId, movingId: element.id }
                    setNextDragState({ movingId: element.id, anchorId: element.id, placement: 'before' })
                    document.body.classList.add('is-layer-dragging')
                    updateDragStateFromPoint(event.clientX, event.clientY)
                  }}
                >
                  <GripVertical size={14} />
                </button>
                <button
                  className="layer-main"
                  type="button"
                  onClick={(event) => onSelectLayer(element.id, event.ctrlKey || event.metaKey)}
                >
                  <span className="layer-type-badge" aria-hidden="true">
                    {getElementTypeIcon(element)}
                  </span>
                  <span className="layer-main-copy">
                    <span className="layer-preview">{getElementPreview(element)}</span>
                  </span>
                </button>
                <div className="layer-actions">
                  {bindable ? (
                    <div className="layer-binding-wrap">
                      <button
                        ref={(node) => {
                          bindingButtonRefs.current[element.id] = node
                        }}
                        className={clsx('mini-button layer-icon-button', groupCount > 0 && 'active')}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          setBindingPopoverElementId((current) => current === element.id ? null : element.id)
                        }}
                        title={groupCount > 0 ? `已绑定 ${groupCount} 个分组` : '绑定分组'}
                        aria-label={groupCount > 0 ? `已绑定 ${groupCount} 个分组` : '绑定分组'}
                      >
                        <Link2 size={14} />
                      </button>
                      {bindingPopoverOpen && bindingPopoverPosition
                        ? createPortal(
                            <div
                              ref={bindingPopoverRef}
                              className="layer-binding-popover"
                              style={{ top: `${bindingPopoverPosition.top}px`, left: `${bindingPopoverPosition.left}px` }}
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="layer-binding-popover-head">
                                <strong>分组</strong>
                                <span>{groupCount > 0 ? `${groupCount} 已绑` : '未绑'}</span>
                              </div>
                              <div className="layer-binding-popover-list">
                                {lexiconGroups.length === 0 ? (
                                  <p className="empty-note">还没有分组。</p>
                                ) : (
                                  lexiconGroups.map((group) => (
                                    <label key={group.id} className="layer-binding-option">
                                      <input
                                        type="checkbox"
                                        checked={elementGroupIds.has(group.id)}
                                        onChange={() => onToggleGroupForElement(element.id, group.id)}
                                      />
                                      <span>
                                        <strong>{group.name}</strong>
                                        <small>{group.entryCount} 条</small>
                                      </span>
                                    </label>
                                  ))
                                )}
                              </div>
                            </div>,
                            document.body,
                          )
                        : null}
                    </div>
                  ) : null}
                  <button className={clsx('mini-button layer-icon-button', element.hidden && 'active')} type="button" onClick={() => onToggleHidden(element.id)} title={element.hidden ? '显示元素' : '隐藏元素'} aria-label={element.hidden ? '显示元素' : '隐藏元素'}>
                    {element.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button className={clsx('mini-button layer-icon-button', element.locked && 'active')} type="button" onClick={() => onToggleLock(element.id)} title={element.locked ? '解锁元素' : '锁定元素'} aria-label={element.locked ? '解锁元素' : '锁定元素'}>
                    {element.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </>
  )

  const renderLexiconEntryRow = (suggestion: LexiconSuggestion) => (
    <div
      key={`${suggestion.groupId}-${suggestion.entryId}`}
      className={clsx(
        'sidebar-entry-manage-row',
        lexiconSelection?.kind === 'entry' && lexiconSelection.entryId === suggestion.entryId && 'active',
        entrySortDrag?.targetGroupId === suggestion.groupId && entrySortDrag.anchorId === suggestion.entryId && `drag-${entrySortDrag.placement}`,
        entrySortDrag?.sourceGroupId === suggestion.groupId && entrySortDrag.movingId === suggestion.entryId && 'dragging',
      )}
      onDragOver={(event) => handleEntrySortOver(suggestion.groupId, suggestion.entryId, event)}
      onDragLeave={() => {
        if (entrySortDrag?.targetGroupId === suggestion.groupId && entrySortDrag.anchorId === suggestion.entryId) {
          setEntrySortDrag((currentDrag) => (currentDrag ? { ...currentDrag, anchorId: currentDrag.movingId } : currentDrag))
        }
      }}
      onDrop={(event) => {
        if (!entrySortDrag || entrySortDrag.targetGroupId !== suggestion.groupId || entrySortDrag.anchorId !== suggestion.entryId || (entrySortDrag.sourceGroupId === suggestion.groupId && entrySortDrag.movingId === suggestion.entryId)) {
          return
        }

        event.preventDefault()
        moveDraggedEntry()
      }}
    >
      <button
        className="sidebar-sort-handle"
        type="button"
        draggable
        aria-label={`拖拽排序条目 ${suggestion.text}`}
        title="拖拽调整条目顺序"
        onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-yibolabel-sort-entry-id', suggestion.entryId)
          beginSidebarSortDrag(event, 'entry', {
            sourceGroupId: suggestion.groupId,
            targetGroupId: suggestion.groupId,
            movingId: suggestion.entryId,
            anchorId: suggestion.entryId,
            placement: 'before',
          })
        }}
        onDragEnd={() => endSidebarSortDrag('entry')}
      >
        <GripVertical size={14} />
      </button>
      <button
        className={clsx('sidebar-entry-row', lexiconSelection?.kind === 'entry' && lexiconSelection.entryId === suggestion.entryId && 'active')}
        type="button"
        draggable
        title="拖到画布元素可应用此条目"
        onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
          event.dataTransfer.effectAllowed = 'copy'
          event.dataTransfer.setData('application/x-yibolabel-entry-text', suggestion.text)
          event.dataTransfer.setData('application/x-yibolabel-entry-group-id', suggestion.groupId)
          event.dataTransfer.setData('text/plain', `yibolabel-entry:${encodeURIComponent(suggestion.groupId)}:${encodeURIComponent(suggestion.text)}`)
          setLexiconDragPayload({ kind: 'entry', text: suggestion.text, groupId: suggestion.groupId })
        }}
        onDragEnd={() => setLexiconDragPayload(null)}
        onClick={() => {
          onActiveGroupChange(suggestion.groupId)
          setLexiconSelection({ kind: 'entry', groupId: suggestion.groupId, entryId: suggestion.entryId })
          setExpandedGroupIds([suggestion.groupId])
        }}
        onDoubleClick={() => {
          if (hasBindingContext) {
            executeEntryApplyAction(suggestion)
          }
        }}
      >
        <span>{suggestion.text}</span>
      </button>
    </div>
  )

  const renderLexiconTab = () => (
    <>
      <div className="sidebar-tab-fixed sidebar-lexicon-fixed">
        <div className="sidebar-search-box">
          <input value={entryQuery} onChange={(event) => setEntryQuery(event.target.value)} placeholder="搜索条目或分组" />
          {entryQuery.trim().length > 0 ? (
            <button className="sidebar-search-clear" type="button" onClick={() => setEntryQuery('')} aria-label="清除搜索">
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="sidebar-tab-scroll sidebar-lexicon-list">
        {activeLexiconGroups.length === 0 ? (
          <div className="sidebar-empty-state">
            <strong>还没有分组</strong>
            <span>先新增分组，再在这里维护条目。</span>
          </div>
        ) : filteredLexiconGroups.length === 0 ? (
          <div className="sidebar-empty-state">
            <strong>没有匹配内容</strong>
            <span>换个关键词试试，或清空搜索查看全部词库。</span>
          </div>
        ) : (
          filteredLexiconGroups.map(({ group, entries }) => {
            const boundCount = bindableSelectedElements.filter((element) => (element.lexiconGroupIds ?? []).includes(group.id)).length
            const checked = hasBindingContext && bindableSelectedElements.length > 0 && boundCount === bindableSelectedElements.length
            const partial = hasBindingContext && boundCount > 0 && boundCount < bindableSelectedElements.length
            const current = activeGroupId === group.id
            const expanded = expandedGroupIds.includes(group.id)
            const items = entries.map((entry) => ({
              entryId: entry.id,
              text: entry.text,
              groupId: group.id,
              groupName: group.name,
              lexiconId: group.lexiconId,
              lexiconName: '',
            } satisfies LexiconSuggestion))

            return (
              <section key={group.id} className="sidebar-lexicon-group">
                <div
                  className={clsx(
                    'sidebar-manage-row',
                    checked && 'active',
                    partial && 'partial',
                    current && 'current',
                    entrySortDrag?.targetGroupId === group.id && entrySortDrag.anchorId === null && 'drop-target',
                    groupSortDrag?.anchorId === group.id && `drag-${groupSortDrag.placement}`,
                    groupSortDrag?.movingId === group.id && 'dragging',
                  )}
                  onDragOver={(event) => {
                    handleGroupSortOver(group.id, event)
                    handleEntryGroupSortOver(group.id, event)
                  }}
                  onDragLeave={() => {
                    if (groupSortDrag?.anchorId === group.id) {
                      setGroupSortDrag((currentDrag) => (currentDrag ? { ...currentDrag, anchorId: currentDrag.movingId } : currentDrag))
                    }
                    if (entrySortDrag?.targetGroupId === group.id && entrySortDrag.anchorId === null) {
                      setEntrySortDrag((currentDrag) => (currentDrag ? { ...currentDrag, anchorId: currentDrag.movingId } : currentDrag))
                    }
                  }}
                  onDrop={(event) => {
                    if (groupSortDrag && groupSortDrag.anchorId === group.id && groupSortDrag.movingId !== group.id) {
                      event.preventDefault()
                      onMoveGroup(groupSortDrag.movingId, group.id, groupSortDrag.placement)
                      endSidebarSortDrag('group')
                      return
                    }

                    if (entrySortDrag && entrySortDrag.targetGroupId === group.id && entrySortDrag.anchorId === null) {
                      event.preventDefault()
                      moveDraggedEntry()
                    }
                  }}
                >
                  <button
                    className="sidebar-sort-handle"
                    type="button"
                    draggable
                    aria-label={`拖拽排序分组 ${group.name}`}
                    title="拖拽调整分组顺序"
                    onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('application/x-yibolabel-sort-group-id', group.id)
                      beginSidebarSortDrag(event, 'group', { movingId: group.id, anchorId: group.id, placement: 'before' })
                    }}
                    onDragEnd={() => endSidebarSortDrag('group')}
                  >
                    <GripVertical size={14} />
                  </button>
                  <button
                    className={clsx('sidebar-list-row', checked && 'active', partial && 'partial', current && 'current')}
                    type="button"
                    draggable
                    title="拖到画布元素可绑定此分组"
                    onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
                      event.dataTransfer.effectAllowed = 'copy'
                      event.dataTransfer.setData('application/x-yibolabel-group-id', group.id)
                      event.dataTransfer.setData('text/plain', `yibolabel-group:${group.id}`)
                      setLexiconDragPayload({ kind: 'group', groupId: group.id })
                    }}
                    onDragEnd={() => setLexiconDragPayload(null)}
                    onClick={() => {
                      onActiveGroupChange(group.id)
                      setLexiconSelection({ kind: 'group', groupId: group.id })
                      setExpandedGroupIds((currentIds) => (currentIds.includes(group.id) ? [] : [group.id]))
                    }}
                    onDoubleClick={() => {
                      if (hasBindingContext) {
                        executeGroupBindAction(group.id)
                      }
                    }}
                  >
                    <span className="sidebar-list-copy">
                      <strong>{group.name}</strong>
                      <small>{group.entries.length} 条</small>
                    </span>
                    <span className="sidebar-list-meta">
                      {partial ? <span>{boundCount}/{bindableSelectedElements.length}</span> : null}
                      {hasBindingContext && checked ? <Check size={14} /> : null}
                    </span>
                  </button>
                </div>
                {expanded ? (
                  <div className="sidebar-group-entries">
                    {items.length === 0 ? (
                      <button className="sidebar-entry-empty-inline" type="button" onClick={() => onCreateEntry(group.id)}>
                        {hasEntryQuery ? '此分组没有匹配条目' : '新增此分组条目'}
                      </button>
                    ) : (
                      items.map(renderLexiconEntryRow)
                    )}
                  </div>
                ) : null}
              </section>
            )
          })
        )}
      </div>

      <div className="sidebar-tab-fixed sidebar-lexicon-actions">
        <div className="sidebar-binding-toolbar sidebar-binding-toolbar-bottom">
          <span className="sidebar-binding-title">绑定标记</span>
          <div className="sidebar-binding-modes" aria-label="绑定显示范围">
            <button
              className={clsx(bindingOverlayEnabled && bindingOverlayScope === 'selected' && 'active')}
              type="button"
              onClick={() => {
                if (bindingOverlayEnabled && bindingOverlayScope === 'selected') {
                  onBindingOverlayEnabledChange(false)
                  return
                }

                onBindingOverlayEnabledChange(true)
                onBindingOverlayScopeChange('selected')
              }}
            >
              {bindingOverlayEnabled && bindingOverlayScope === 'selected' ? <Check size={12} /> : null}
              选中
            </button>
            <button
              className={clsx(bindingOverlayEnabled && bindingOverlayScope === 'all' && 'active')}
              type="button"
              onClick={() => {
                if (bindingOverlayEnabled && bindingOverlayScope === 'all') {
                  onBindingOverlayEnabledChange(false)
                  return
                }

                onBindingOverlayEnabledChange(true)
                onBindingOverlayScopeChange('all')
              }}
            >
              {bindingOverlayEnabled && bindingOverlayScope === 'all' ? <Check size={12} /> : null}
              全部
            </button>
          </div>
        </div>
        <div className="sidebar-lexicon-action-grid">
          <div className="sidebar-lexicon-primary-row">
            <button
              className="mini-button sidebar-lexicon-primary-action"
              type="button"
              onClick={runSelectedLexiconAction}
              disabled={!canExecuteSelectedLexiconAction}
            >
              {primaryLexiconAction?.kind === 'apply-entry' ? <Check size={12} /> : <Link2 size={12} />}
              {selectedLexiconActionLabel}
            </button>
            <button
              className="mini-button sidebar-lexicon-undo-action"
              type="button"
              onClick={onUndoLastLexiconAction}
              disabled={!lastLexiconAction}
              aria-label={lastLexiconAction ? undoActionLabel : '撤回最近词库动作'}
              title={lastLexiconAction ? undoActionLabel : '撤回最近词库动作'}
            >
              <RotateCcw size={12} />
              {undoActionLabel}
            </button>
          </div>
          <button className="mini-button" type="button" onClick={onCreateGroup}>
            <Plus size={12} />
            分组
          </button>
          <button
            className="mini-button"
            type="button"
            onClick={() => {
              const targetGroupId = lexiconSelection?.kind === 'entry' ? lexiconSelection.groupId : currentGroup?.id
              if (targetGroupId) {
                onCreateEntry(targetGroupId)
              }
            }}
            disabled={!currentGroup && lexiconSelection?.kind !== 'entry'}
          >
            <Plus size={12} />
            条目
          </button>
          <button
            className="mini-button"
            type="button"
            onClick={() => {
              if (lexiconSelection?.kind === 'entry') {
                onRenameEntry(lexiconSelection.groupId, lexiconSelection.entryId)
                return
              }

              if (currentGroup) {
                onRenameGroup(currentGroup.id)
              }
            }}
            disabled={!currentGroup && lexiconSelection?.kind !== 'entry'}
          >
            <Pencil size={12} />
            改名
          </button>
          <button
            className="mini-button"
            type="button"
            onClick={() => {
              if (lexiconSelection?.kind === 'entry') {
                onDeleteEntry(lexiconSelection.groupId, lexiconSelection.entryId)
                return
              }

              if (currentGroup) {
                onDeleteGroup(currentGroup.id)
              }
            }}
            disabled={!currentGroup && lexiconSelection?.kind !== 'entry'}
          >
            <Trash2 size={12} />
            删除
          </button>
        </div>
      </div>
    </>
  )

  const renderTemplatesTab = () => (
    <>
      <div className="sidebar-tab-fixed sidebar-template-fixed">
        <div className="sidebar-search-box sidebar-template-search">
          <input
            value={templateQuery}
            onChange={(event) => onTemplateQueryChange(event.target.value)}
            placeholder="搜索模板名称"
          />
          {templateQuery.trim().length > 0 ? (
            <button className="sidebar-search-clear" type="button" onClick={() => onTemplateQueryChange('')} aria-label="清除搜索">
              <X size={12} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="sidebar-tab-scroll sidebar-template-list">
        {templates.length === 0 ? (
          <div className="sidebar-empty-state">
            <strong>暂无模板</strong>
            <span>当前模板库还是空的。</span>
          </div>
        ) : visibleTemplates.length === 0 ? (
          <div className="sidebar-empty-state">
            <strong>没有匹配模板</strong>
            <span>换个关键词试试，当前预览不会被清空。</span>
          </div>
        ) : (
          visibleTemplates.map((template) => {
            const openedState = openedTemplateState.get(template.id)
            const templateStatus = openedState?.current ? '当前' : openedState?.dirty ? '修改' : openedState?.openCount ? '已开' : null
            return (
              <div
                key={template.id}
                className={clsx(
                  'sidebar-manage-row sidebar-template-manage-row',
                  previewTemplateId === template.id && 'active',
                  openedState?.current && 'current',
                  templateSortDrag?.anchorId === template.id && `drag-${templateSortDrag.placement}`,
                  templateSortDrag?.movingId === template.id && 'dragging',
                )}
                onDragOver={(event) => {
                  if (!templateSortDrag || templateSortDrag.movingId === template.id) {
                    return
                  }

                  event.preventDefault()
                  setTemplateSortDrag({
                    movingId: templateSortDrag.movingId,
                    anchorId: template.id,
                    placement: getSortPlacement(event),
                  })
                }}
                onDragLeave={() => {
                  if (templateSortDrag?.anchorId === template.id) {
                    setTemplateSortDrag((currentDrag) => (currentDrag ? { ...currentDrag, anchorId: currentDrag.movingId } : currentDrag))
                  }
                }}
                onDrop={(event) => {
                  if (!templateSortDrag || templateSortDrag.anchorId !== template.id || templateSortDrag.movingId === template.id) {
                    return
                  }

                  event.preventDefault()
                  onMoveTemplate(templateSortDrag.movingId, template.id, templateSortDrag.placement)
                  endSidebarSortDrag('template')
                }}
              >
                <button
                  className="sidebar-sort-handle"
                  type="button"
                  draggable
                  aria-label={`拖拽排序模板 ${template.name}`}
                  title="拖拽调整模板顺序"
                  onDragStart={(event: ReactDragEvent<HTMLButtonElement>) => {
                    event.dataTransfer.effectAllowed = 'move'
                    beginSidebarSortDrag(event, 'template', { movingId: template.id, anchorId: template.id, placement: 'before' })
                  }}
                  onDragEnd={() => endSidebarSortDrag('template')}
                >
                  <GripVertical size={14} />
                </button>
                <button
                  className={clsx('sidebar-list-row sidebar-template-list-row', previewTemplateId === template.id && 'active', openedState?.current && 'current')}
                  type="button"
                  title={template.name}
                  onClick={() => onSelectPreviewTemplate(template.id)}
                  onDoubleClick={() => onOpenTemplate(template.id)}
                >
                  <span className="sidebar-list-copy">
                    <strong>{template.name}</strong>
                    {templateStatus ? <small>{templateStatus}</small> : <small>{template.widthMm}×{template.heightMm}</small>}
                  </span>
                </button>
              </div>
            )
          })
        )}
      </div>

      <div className="sidebar-tab-fixed sidebar-template-actions">
        <div className="sidebar-template-action-row">
          <button
            className="mini-button"
            type="button"
            onClick={() => {
              const selected = templates.find((template) => template.id === previewTemplateId)
              if (selected) {
                onDuplicateTemplate(selected)
              }
            }}
            disabled={!previewTemplateId}
          >
            <Copy size={12} />
            复制
          </button>
          <button
            className="mini-button"
            type="button"
            onClick={() => {
              const selected = templates.find((template) => template.id === previewTemplateId)
              if (selected) {
                onRenameTemplate(selected)
              }
            }}
            disabled={!previewTemplateId}
          >
            <Pencil size={12} />
            重命名
          </button>
          <button
            className="mini-button"
            type="button"
            onClick={() => {
              const selected = templates.find((template) => template.id === previewTemplateId)
              if (selected) {
                onDeleteTemplate(selected)
              }
            }}
            disabled={!previewTemplateId}
          >
            <Trash2 size={12} />
            删除
          </button>
        </div>
      </div>
    </>
  )

  return (
    <aside className="sidebar template-sidebar">
      <section className="panel template-sidebar-panel">
        <div className="template-sidebar-tabs" role="tablist" aria-label="模板左侧工作区">
          <button className={clsx(activeTab === 'elements' && 'active')} type="button" role="tab" aria-selected={activeTab === 'elements'} onClick={() => onSidebarTabChange('elements')}>
            元素
          </button>
          <button className={clsx(activeTab === 'lexicon' && 'active')} type="button" role="tab" aria-selected={activeTab === 'lexicon'} onClick={() => onSidebarTabChange('lexicon')}>
            词库
          </button>
          <button className={clsx(activeTab === 'templates' && 'active')} type="button" role="tab" aria-selected={activeTab === 'templates'} onClick={() => onSidebarTabChange('templates')}>
            模板
          </button>
        </div>

        <div className="template-sidebar-body">
          {activeTab === 'elements' ? renderElementsTab() : activeTab === 'lexicon' ? renderLexiconTab() : renderTemplatesTab()}
        </div>
      </section>
    </aside>
  )
}
