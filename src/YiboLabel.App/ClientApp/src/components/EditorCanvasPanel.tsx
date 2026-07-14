import { FilePlus2, RotateCcw, Upload } from 'lucide-react'
import clsx from 'clsx'
import type { PointerEvent as ReactPointerEvent, RefObject, WheelEvent as ReactWheelEvent } from 'react'
import type { Bounds, RulerTick, SnapLine } from '../domain/editorGeometry'
import { isLexiconEnabledElement } from '../domain/labelDocument'
import { ElementPreview } from './ElementInspector'
import type { LabelDocument, LabelElement } from '../types'

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

type EditorCanvasPanelProps = {
  hasActiveTab: boolean
  labelDocument: LabelDocument
  activeTemplateId: string | null
  activeTabDirty: boolean
  selectedElementIds: string[]
  visibleElementsCount: number
  bindableSelectedCount: number
  contentPickerOpen: boolean
  groupBinderOpen: boolean
  canvasScale: number
  horizontalRulerTicks: RulerTick[]
  verticalRulerTicks: RulerTick[]
  canvasWrapRef: RefObject<HTMLDivElement | null>
  canvasRef: RefObject<HTMLDivElement | null>
  resolvedVisibleElements: LabelElement[]
  selectedElement: LabelElement | null
  selectionBounds: Bounds | null
  snapLines: SnapLine[]
  marqueeBounds: Bounds | null
  recentClosedTabsCount: number
  onToggleGroupBinder: () => void
  onToggleContentPicker: () => void
  onDuplicateSelected: () => void
  onDeleteSelected: () => void
  onCanvasWrapPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onCanvasWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
  onCanvasPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onElementPointerDown: (element: LabelElement, event: ReactPointerEvent<HTMLDivElement>) => void
  onResizeHandlePointerDown: (handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => void
  onRotatePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onCreateFreshDocument: () => void
  onImportDdl: () => void
  onReopenLastClosedTab: () => void
}

export function EditorCanvasPanel({
  hasActiveTab,
  labelDocument,
  activeTemplateId,
  activeTabDirty,
  selectedElementIds,
  visibleElementsCount,
  bindableSelectedCount,
  contentPickerOpen,
  groupBinderOpen,
  canvasScale,
  horizontalRulerTicks,
  verticalRulerTicks,
  canvasWrapRef,
  canvasRef,
  resolvedVisibleElements,
  selectedElement,
  selectionBounds,
  snapLines,
  marqueeBounds,
  recentClosedTabsCount,
  onToggleGroupBinder,
  onToggleContentPicker,
  onDuplicateSelected,
  onDeleteSelected,
  onCanvasWrapPointerDown,
  onCanvasWheel,
  onCanvasPointerDown,
  onElementPointerDown,
  onResizeHandlePointerDown,
  onRotatePointerDown,
  onCreateFreshDocument,
  onImportDdl,
  onReopenLastClosedTab,
}: EditorCanvasPanelProps) {
  return (
    <section className="canvas-panel">
      {hasActiveTab ? (
        <>
          <div className="canvas-toolbar canvas-toolbar-compact">
            <div className="canvas-toolbar-group">
              <div className="document-state">
                <span className={clsx('document-state-badge', activeTemplateId ? 'template' : 'draft')}>
                  {activeTemplateId ? '模板草稿' : '未绑定草稿'}
                </span>
                <span className={clsx('document-state-badge', activeTabDirty ? 'dirty' : 'saved')}>
                  {activeTabDirty ? '未保存修改' : '已保存'}
                </span>
              </div>
              <button className="mini-button" disabled={selectedElementIds.length === 0} onClick={onDuplicateSelected}>
                复制所选
              </button>
              <button className="mini-button" disabled={selectedElementIds.length === 0} onClick={onDeleteSelected}>
                删除所选
              </button>
              <button className={clsx('mini-button', groupBinderOpen && 'active')} disabled={bindableSelectedCount === 0} onClick={onToggleGroupBinder}>
                分组绑定
              </button>
              <button className={clsx('mini-button', contentPickerOpen && 'active')} disabled={!isLexiconEnabledElement(selectedElement)} onClick={onToggleContentPicker}>
                内容候选
              </button>
            </div>
            <div className="canvas-metrics">
              <div>
                <span>元素数</span>
                <strong>{labelDocument.elements.length}</strong>
              </div>
              <div>
                <span>选中元素</span>
                <strong>{selectedElementIds.length}</strong>
              </div>
              <div>
                <span>可见元素</span>
                <strong>{visibleElementsCount}</strong>
              </div>
            </div>
            <p className="canvas-toolbar-tip">Ctrl 多选，Alt 选下层元素，方向键微调</p>
          </div>

          <div ref={canvasWrapRef} className="canvas-wrap" onPointerDown={onCanvasWrapPointerDown} onWheel={onCanvasWheel}>
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
                onPointerDown={onCanvasPointerDown}
              >
                <div className="grid-overlay" />
                {resolvedVisibleElements.map((element) => (
                  <div
                    key={element.id}
                    className={clsx('canvas-element', selectedElementIds.includes(element.id) && 'selected', element.locked && 'locked')}
                    style={{
                      left: `${element.x * canvasScale}px`,
                      top: `${element.y * canvasScale}px`,
                      width: `${element.width * canvasScale}px`,
                      height: `${element.height * canvasScale}px`,
                      transform: `rotate(${element.rotation}deg)`,
                      zIndex: element.zIndex ?? 0,
                    }}
                    onPointerDown={(event) => onElementPointerDown(element, event)}
                  >
                    <ElementPreview element={element} canvasScale={canvasScale} />
                  </div>
                ))}

                {selectionBounds ? (
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
                    {selectedElement && !selectedElement.locked ? (
                      <>
                        {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeHandle[]).map((handle) => (
                          <button
                            key={handle}
                            className={clsx('selection-handle', `handle-${handle}`)}
                            onPointerDown={(event) => onResizeHandlePointerDown(handle, event)}
                          />
                        ))}
                        <button className="rotation-handle" onPointerDown={onRotatePointerDown} />
                      </>
                    ) : null}
                  </div>
                ) : null}

                {snapLines.map((line) => (
                  <div
                    key={`${line.orientation}-${line.value}`}
                    className={clsx('snap-line', line.orientation)}
                    style={line.orientation === 'vertical' ? { left: `${line.value * canvasScale}px` } : { top: `${line.value * canvasScale}px` }}
                  />
                ))}

                {marqueeBounds ? (
                  <div
                    className="marquee-box"
                    style={{
                      left: `${marqueeBounds.left * canvasScale}px`,
                      top: `${marqueeBounds.top * canvasScale}px`,
                      width: `${marqueeBounds.width * canvasScale}px`,
                      height: `${marqueeBounds.height * canvasScale}px`,
                    }}
                  />
                ) : null}
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
            <button className="action-button" onClick={onCreateFreshDocument}>
              <FilePlus2 size={16} />
              新建标签
            </button>
            <button className="ghost-button" onClick={onImportDdl}>
              <Upload size={16} />
              导入 DDL
            </button>
            <button className="ghost-button" onClick={onReopenLastClosedTab} disabled={recentClosedTabsCount === 0}>
              <RotateCcw size={16} />
              恢复关闭标签
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
