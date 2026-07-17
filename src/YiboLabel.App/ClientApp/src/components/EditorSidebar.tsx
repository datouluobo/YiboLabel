import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Eye,
  EyeOff,
  GripVertical,
  ImagePlus,
  Layers,
  LockKeyhole,
  Minus,
  CircleHelp,
  QrCode,
  ScanBarcode,
  Square,
  Type,
  UnlockKeyhole,
} from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { getDefaultElementName } from '../domain/labelDocument'
import { LayerActionButton, ToolButton } from './ElementInspector'
import type { LabelElement } from '../types'

type EditorSidebarProps = {
  hasActiveTab: boolean
  selectedElementIds: string[]
  sortedElements: LabelElement[]
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
}

export function EditorSidebar({
  hasActiveTab,
  selectedElementIds,
  sortedElements,
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
}: EditorSidebarProps) {
  const [dragState, setDragState] = useState<{ movingId: string; anchorId: string; placement: 'before' | 'after' } | null>(null)
  const pointerDragRef = useRef<{ pointerId: number; movingId: string } | null>(null)

  const setNextDragState = (next: { movingId: string; anchorId: string; placement: 'before' | 'after' } | null) => {
    setDragState(next)
  }

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

  return (
    <aside className="sidebar">
      <section className="panel insert-panel">
        <div className="tool-grid">
          <ToolButton icon={<Type size={16} />} label="文本" onClick={onAddText} />
          <ToolButton icon={<ScanBarcode size={16} />} label="条码" onClick={onAddBarcode} />
          <ToolButton icon={<QrCode size={16} />} label="二维码" onClick={onAddQrCode} />
          <ToolButton icon={<Minus size={16} />} label="线条" onClick={onAddLine} />
          <ToolButton icon={<Square size={16} />} label="矩形" onClick={onAddRectangle} />
          <ToolButton icon={<ImagePlus size={16} />} label="图片" onClick={onAddImage} />
        </div>
      </section>

      <section className="panel layers-panel">
        <div className="panel-heading">
          <span className="panel-title-with-icon">
            <Layers size={15} />
            元素
            <span
              className="panel-help"
              title="列表越靠上，画布越靠上。可拖拽调整顺序；Ctrl + 点击元素可多选，Alt + 点击画布可穿透选择下层元素。"
              aria-label="元素列表说明"
            >
              <CircleHelp size={13} />
            </span>
          </span>
          <strong>{selectedElementIds.length > 0 ? `${selectedElementIds.length} / ${sortedElements.length}` : sortedElements.length}</strong>
        </div>
        <div className="layer-toolbar" aria-label="元素顺序操作">
          <LayerActionButton icon={<ChevronsUp size={14} />} label="置顶" disabled={selectedElementIds.length === 0} onClick={onReorderFront} />
          <LayerActionButton icon={<ArrowUp size={14} />} label="上移" disabled={selectedElementIds.length === 0} onClick={onReorderForward} />
          <LayerActionButton icon={<ArrowDown size={14} />} label="下移" disabled={selectedElementIds.length === 0} onClick={onReorderBackward} />
          <LayerActionButton icon={<ChevronsDown size={14} />} label="置底" disabled={selectedElementIds.length === 0} onClick={onReorderBack} />
        </div>
        <div className="layer-list">
          {!hasActiveTab ? (
            <p className="empty-note">当前没有打开的文件，所以也没有可管理的元素。</p>
          ) : sortedElements.length === 0 ? (
            <p className="empty-note">还没有元素。先从上方插入文本、条码、二维码或形状。</p>
          ) : (
            sortedElements.map((element) => (
              <div
                key={element.id}
                data-layer-row-id={element.id}
                className={clsx(
                  'layer-row',
                  selectedElementIds.includes(element.id) && 'selected',
                  dragState?.anchorId === element.id && `drag-${dragState.placement}`,
                  dragState?.movingId === element.id && 'dragging',
                )}
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
                  <span className="layer-preview">{getElementPreview(element)}</span>
                </button>
                <div className="layer-actions">
                  <button className={clsx('mini-button layer-icon-button', element.hidden && 'active')} type="button" onClick={() => onToggleHidden(element.id)} title={element.hidden ? '显示元素' : '隐藏元素'} aria-label={element.hidden ? '显示元素' : '隐藏元素'}>
                    {element.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <button className={clsx('mini-button layer-icon-button', element.locked && 'active')} type="button" onClick={() => onToggleLock(element.id)} title={element.locked ? '解锁元素' : '锁定元素'} aria-label={element.locked ? '解锁元素' : '锁定元素'}>
                    {element.locked ? <LockKeyhole size={14} /> : <UnlockKeyhole size={14} />}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  )
}
