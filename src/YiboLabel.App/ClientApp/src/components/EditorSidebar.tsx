import {
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  Eye,
  EyeOff,
  ImagePlus,
  Layers,
  LockKeyhole,
  Minus,
  QrCode,
  ScanBarcode,
  Square,
  Type,
  UnlockKeyhole,
} from 'lucide-react'
import clsx from 'clsx'
import { getLayerMeta } from '../domain/labelDocument'
import { getLayerPositionLabel } from '../domain/templateMetadata'
import { LayerActionButton, ToolButton } from './ElementInspector'
import type { LabelElement } from '../types'

type EditorSidebarProps = {
  hasActiveTab: boolean
  elementCount: number
  layersCollapsed: boolean
  selectedElementIds: string[]
  sortedElements: LabelElement[]
  onAddText: () => void
  onAddBarcode: () => void
  onAddQrCode: () => void
  onAddLine: () => void
  onAddRectangle: () => void
  onAddImage: () => void
  onToggleLayersCollapsed: () => void
  onReorderFront: () => void
  onReorderForward: () => void
  onReorderBackward: () => void
  onReorderBack: () => void
  onSelectLayer: (elementId: string, additive: boolean) => void
  onToggleHidden: (elementId: string) => void
  onToggleLock: (elementId: string) => void
}

export function EditorSidebar({
  hasActiveTab,
  elementCount,
  layersCollapsed,
  selectedElementIds,
  sortedElements,
  onAddText,
  onAddBarcode,
  onAddQrCode,
  onAddLine,
  onAddRectangle,
  onAddImage,
  onToggleLayersCollapsed,
  onReorderFront,
  onReorderForward,
  onReorderBackward,
  onReorderBack,
  onSelectLayer,
  onToggleHidden,
  onToggleLock,
}: EditorSidebarProps) {
  return (
    <aside className="sidebar">
      <section className="panel insert-panel">
        <div className="panel-heading">
          <span>插入对象</span>
          <span>{elementCount}</span>
        </div>
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
        <div className="panel-heading panel-heading-button">
          <button className="collapse-trigger" onClick={onToggleLayersCollapsed}>
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
              <LayerActionButton icon={<ChevronsUp size={14} />} label="置顶" disabled={selectedElementIds.length === 0} onClick={onReorderFront} />
              <LayerActionButton icon={<ArrowUp size={14} />} label="上移" disabled={selectedElementIds.length === 0} onClick={onReorderForward} />
              <LayerActionButton icon={<ArrowDown size={14} />} label="下移" disabled={selectedElementIds.length === 0} onClick={onReorderBackward} />
              <LayerActionButton icon={<ChevronsDown size={14} />} label="置底" disabled={selectedElementIds.length === 0} onClick={onReorderBack} />
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
                      onClick={(event) => onSelectLayer(element.id, event.ctrlKey || event.metaKey)}
                    >
                      <span className="layer-name-row">
                        <strong>{element.name}</strong>
                        <small>{getLayerPositionLabel(element, sortedElements.length)}</small>
                      </span>
                      <span>{getLayerMeta(element)}</span>
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
            <p className="panel-note">上方按钮调整选中对象层级；Ctrl + 点击图层可多选，Alt + 点击画布可穿透选择下层对象。</p>
          </>
        ) : null}
      </section>
    </aside>
  )
}
