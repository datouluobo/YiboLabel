import { CircleHelp, FilePlus2, RotateCcw, Upload } from 'lucide-react'
import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent as ReactDragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type RefObject, type WheelEvent as ReactWheelEvent } from 'react'
import { getElementsAtPoint, pointFromPointer, type Bounds, type RulerTick, type SnapLine } from '../domain/editorGeometry'
import { createBindingOverlayLayouts } from '../domain/bindingOverlayLayout'
import { getBarcodeLayout, getQrCodeLayout } from '../domain/codeElementLayout'
import type { LexiconActionSource } from '../domain/lexiconActions'
import { getLexiconDragPayload, setLexiconDragPayload } from '../domain/lexiconDragPayload'
import { isLexiconEnabledElement, normalizeFontFamily, pointsToMm } from '../domain/labelDocument'
import type { EditorTab } from '../domain/workspace'
import { ElementPreview } from './ElementInspector'
import type { BarcodeElement, LabelDocument, LabelElement, QrCodeElement, TextElement } from '../types'

type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
type CanvasDropFeedback = { elementId: string; tone: 'valid' | 'invalid'; message: string }

type EditorCanvasPanelProps = {
  hasActiveTab: boolean
  labelDocument: LabelDocument
  activeTemplateId: string | null
  status: string
  history: EditorTab['history']
  selectedElementIds: string[]
  exporting: boolean
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
  bindingOverlayElements: { elementId: string; names: string[] }[]
  inlineEditingElement: LabelElement | null
  inlineEditingValue: string
  recentClosedTabsCount: number
  onUndo: () => void
  onRedo: () => void
  onDuplicateSelected: () => void
  onDeleteSelected: () => void
  onCanvasWrapPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onCanvasWheel: (event: ReactWheelEvent<HTMLDivElement>) => void
  onCanvasPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onElementPointerDown: (element: LabelElement, event: ReactPointerEvent<HTMLDivElement>) => void
  onElementDoubleClick: (element: LabelElement, event: ReactMouseEvent<HTMLDivElement>) => void
  onResizeHandlePointerDown: (handle: ResizeHandle, event: ReactPointerEvent<HTMLButtonElement>) => void
  onRotatePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onInlineEditorChange: (value: string) => void
  onInlineEditorCommit: () => void
  onInlineEditorCancel: () => void
  onCreateFreshDocument: () => void
  onImportDdl: () => void
  onReopenLastClosedTab: () => void
  onBindGroupToElement: (elementId: string, groupId: string, source?: LexiconActionSource) => void
  onApplyEntryToElement: (elementId: string, text: string, groupId: string | null, source?: LexiconActionSource) => void
}

export function EditorCanvasPanel({
  hasActiveTab,
  labelDocument,
  activeTemplateId,
  status,
  history,
  selectedElementIds,
  exporting,
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
  bindingOverlayElements,
  inlineEditingElement,
  inlineEditingValue,
  recentClosedTabsCount,
  onUndo,
  onRedo,
  onDuplicateSelected,
  onDeleteSelected,
  onCanvasWrapPointerDown,
  onCanvasWheel,
  onCanvasPointerDown,
  onElementPointerDown,
  onElementDoubleClick,
  onResizeHandlePointerDown,
  onRotatePointerDown,
  onInlineEditorChange,
  onInlineEditorCommit,
  onInlineEditorCancel,
  onCreateFreshDocument,
  onImportDdl,
  onReopenLastClosedTab,
  onBindGroupToElement,
  onApplyEntryToElement,
}: EditorCanvasPanelProps) {
  const [dropTargetElementId, setDropTargetElementId] = useState<string | null>(null)
  const [dropFeedback, setDropFeedback] = useState<CanvasDropFeedback | null>(null)

  const bindingOverlayLayouts = useMemo(() => createBindingOverlayLayouts({
    items: bindingOverlayElements,
    elements: resolvedVisibleElements,
    canvasWidth: labelDocument.widthMm * canvasScale,
    canvasHeight: labelDocument.heightMm * canvasScale,
    scale: canvasScale,
  }), [bindingOverlayElements, canvasScale, labelDocument.heightMm, labelDocument.widthMm, resolvedVisibleElements])
  const bindingOverlayZIndex = useMemo(
    () => Math.max(0, ...resolvedVisibleElements.map((element) => element.zIndex ?? 0)) + 2,
    [resolvedVisibleElements],
  )

  function readPlainDragPayload(event: ReactDragEvent<HTMLElement>) {
    return event.dataTransfer.getData('text/plain')
  }

  function hasLexiconDragPayload(event: ReactDragEvent<HTMLElement>) {
    const types = Array.from(event.dataTransfer.types)
    return types.includes('application/x-yibolabel-group-id')
      || types.includes('application/x-yibolabel-entry-text')
      || types.includes('application/x-yibolabel-entry-group-id')
      || types.includes('text/plain')
  }

  function readDraggedGroupId(event: ReactDragEvent<HTMLElement>) {
    const cachedPayload = getLexiconDragPayload()
    if (cachedPayload?.kind === 'group') {
      return cachedPayload.groupId
    }

    const directValue = event.dataTransfer.getData('application/x-yibolabel-group-id')
    if (directValue) {
      return directValue
    }

    const plainValue = readPlainDragPayload(event)
    return plainValue.startsWith('yibolabel-group:') ? plainValue.slice('yibolabel-group:'.length) : ''
  }

  function readDraggedEntryText(event: ReactDragEvent<HTMLElement>) {
    const cachedPayload = getLexiconDragPayload()
    if (cachedPayload?.kind === 'entry') {
      return cachedPayload.text
    }

    const directValue = event.dataTransfer.getData('application/x-yibolabel-entry-text')
    if (directValue) {
      return directValue
    }

    const plainValue = readPlainDragPayload(event)
    if (!plainValue.startsWith('yibolabel-entry:')) {
      return ''
    }

    const [, , encodedText = ''] = plainValue.split(':')
    return decodeURIComponent(encodedText)
  }

  function readDraggedEntryGroupId(event: ReactDragEvent<HTMLElement>) {
    const cachedPayload = getLexiconDragPayload()
    if (cachedPayload?.kind === 'entry') {
      return cachedPayload.groupId
    }

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

  function resolveCanvasDropTarget(event: ReactDragEvent<HTMLDivElement>) {
    const target = event.target
    if (target instanceof Element) {
      const elementId = target.closest<HTMLElement>('[data-canvas-element-id]')?.dataset.canvasElementId
      if (elementId) {
        return labelDocument.elements.find((element) => element.id === elementId) ?? null
      }
    }

    if (!canvasRef.current) {
      return null
    }

    const point = pointFromPointer(canvasRef.current.getBoundingClientRect(), event, canvasScale)
    const hovered = [...getElementsAtPoint(labelDocument, point)].reverse()

    return hovered[0] ?? null
  }

  function validateCode128Value(value: string) {
    if (value.trim().length === 0) {
      return '不可应用：内容为空'
    }

    if (/[\r\n]/.test(value)) {
      return '不可应用：条码不支持换行'
    }

    if (!/^[\x20-\x7E]+$/.test(value)) {
      return '不可应用：Code128 不支持该字符'
    }

    return null
  }

  function getDropFeedback(targetElement: LabelElement | null, event: ReactDragEvent<HTMLDivElement>): CanvasDropFeedback | null {
    if (!targetElement) {
      return null
    }

    const entryText = readDraggedEntryText(event)
    const groupId = readDraggedGroupId(event)
    if (!entryText && !groupId) {
      return null
    }

    if (groupId) {
      if (isLexiconEnabledElement(targetElement)) {
        return { elementId: targetElement.id, tone: 'valid', message: '绑定分组' }
      }

      return { elementId: targetElement.id, tone: 'invalid', message: '不可绑定：该元素不支持词库' }
    }

    if (targetElement.type === 'text') {
      return { elementId: targetElement.id, tone: 'valid', message: '应用到文本' }
    }

    if (targetElement.type === 'qrcode') {
      return { elementId: targetElement.id, tone: 'valid', message: '应用到二维码' }
    }

    if (targetElement.type === 'barcode') {
      const error = validateCode128Value(entryText)
      return {
        elementId: targetElement.id,
        tone: error ? 'invalid' : 'valid',
        message: error ?? '应用到条码',
      }
    }

    return { elementId: targetElement.id, tone: 'invalid', message: '不可应用：该元素不支持文本' }
  }

  function handleCanvasDragLeave(event: ReactDragEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return
    }

    setDropTargetElementId(null)
    setDropFeedback(null)
  }

  return (
    <section className="canvas-panel">
      {hasActiveTab ? (
        <>
          <div className="canvas-toolbar canvas-toolbar-compact">
            <div className="canvas-toolbar-notice" title={status}>
              <span className={clsx('canvas-toolbar-notice-dot', activeTemplateId ? 'template' : 'draft')} aria-hidden="true" />
              <span>{status}</span>
            </div>
            <div className="canvas-toolbar-spacer" aria-hidden="true" />
            <div className="canvas-toolbar-group canvas-toolbar-selection">
              <button className="mini-button" disabled={selectedElementIds.length === 0} onClick={onDuplicateSelected}>
                复制
              </button>
              <button className="mini-button" disabled={selectedElementIds.length === 0} onClick={onDeleteSelected}>
                删除
              </button>
            </div>
            <div className="canvas-toolbar-group canvas-toolbar-history">
              <button className="mini-button" onClick={onUndo} disabled={history.past.length === 0}>
                撤销
              </button>
              <button className="mini-button" onClick={onRedo} disabled={history.future.length === 0}>
                重做
              </button>
            </div>
            <span className="panel-help toolbar-help" title="Ctrl 多选，Alt 选下层元素，方向键微调，Enter 确认编辑；文本元素可用 Alt/Ctrl+Enter 换行" aria-label="画布操作说明">
              <CircleHelp size={13} />
            </span>
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
                onDragOver={(event) => {
                  if (!hasLexiconDragPayload(event)) {
                    return
                  }

                  const targetElement = resolveCanvasDropTarget(event)
                  const nextFeedback = getDropFeedback(targetElement, event)
                  if (!nextFeedback) {
                    setDropTargetElementId(null)
                    setDropFeedback(null)
                    return
                  }

                  event.preventDefault()
                  event.dataTransfer.dropEffect = nextFeedback.tone === 'valid' ? 'copy' : 'none'
                  if (dropTargetElementId !== nextFeedback.elementId) {
                    setDropTargetElementId(nextFeedback.elementId)
                  }
                  if (
                    !dropFeedback
                    || dropFeedback.elementId !== nextFeedback.elementId
                    || dropFeedback.tone !== nextFeedback.tone
                    || dropFeedback.message !== nextFeedback.message
                  ) {
                    setDropFeedback(nextFeedback)
                  }
                }}
                onDragLeave={handleCanvasDragLeave}
                onDrop={(event) => {
                  const targetElement = resolveCanvasDropTarget(event)
                  const nextFeedback = getDropFeedback(targetElement, event)
                  if (!nextFeedback) {
                    setDropTargetElementId(null)
                    setDropFeedback(null)
                    return
                  }

                  event.preventDefault()
                  setDropTargetElementId(null)
                  setDropFeedback(null)
                  setLexiconDragPayload(null)
                  if (nextFeedback.tone !== 'valid' || !targetElement) {
                    return
                  }

                  const entryText = readDraggedEntryText(event)
                  const entryGroupId = readDraggedEntryGroupId(event)
                  const groupId = readDraggedGroupId(event)
                  if (entryText) {
                    onApplyEntryToElement(targetElement.id, entryText, entryGroupId, 'drag-drop')
                    return
                  }

                  onBindGroupToElement(targetElement.id, groupId, 'drag-drop')
                }}
              >
                {exporting ? null : <div className="grid-overlay" />}
                {resolvedVisibleElements.map((element) => (
                  element.id === inlineEditingElement?.id ? null : (
                  <div
                    key={element.id}
                    data-canvas-element-id={element.id}
                    className={clsx(
                      'canvas-element',
                      !exporting && selectedElementIds.includes(element.id) && 'selected',
                      element.locked && 'locked',
                      dropTargetElementId === element.id && dropFeedback?.tone === 'valid' && 'group-drop-target',
                      dropTargetElementId === element.id && dropFeedback?.tone === 'invalid' && 'group-drop-target-invalid',
                    )}
                    style={{
                      left: `${element.x * canvasScale}px`,
                      top: `${element.y * canvasScale}px`,
                      width: `${element.width * canvasScale}px`,
                      height: `${element.height * canvasScale}px`,
                      transform: `rotate(${element.rotation}deg)`,
                      zIndex: element.zIndex ?? 0,
                    }}
                    onPointerDown={(event) => onElementPointerDown(element, event)}
                    onDoubleClick={(event) => onElementDoubleClick(element, event)}
                  >
                    <ElementPreview element={element} canvasScale={canvasScale} />
                    {!exporting && dropFeedback?.elementId === element.id ? (
                      <div className={clsx('canvas-drop-hint', dropFeedback.tone === 'invalid' && 'invalid')}>
                        {dropFeedback.message}
                      </div>
                    ) : null}
                  </div>
                  )
                ))}

                {!exporting ? bindingOverlayLayouts.map((layout) => (
                  <div
                    key={layout.elementId}
                    className="canvas-binding-badges"
                    data-placement={layout.placement}
                    style={{
                      left: `${layout.left}px`,
                      top: `${layout.top}px`,
                      width: `${layout.width}px`,
                      height: `${layout.height}px`,
                      zIndex: bindingOverlayZIndex,
                      '--binding-anchor-offset': `${layout.anchorOffset}px`,
                    } as CSSProperties}
                    aria-label={`已绑定分组：${layout.names.join('、')}`}
                  >
                    {layout.names.map((name, index) => (
                      <div key={`${layout.elementId}-${index}-${name}`} className="canvas-binding-badge">
                        {name}
                      </div>
                    ))}
                  </div>
                )) : null}

                {!exporting && inlineEditingElement && isLexiconEnabledElement(inlineEditingElement) ? (
                  <InlineContentEditor
                    element={inlineEditingElement}
                    value={inlineEditingValue}
                    canvasScale={canvasScale}
                    onChange={onInlineEditorChange}
                    onCommit={onInlineEditorCommit}
                    onCancel={onInlineEditorCancel}
                  />
                ) : null}

                {!exporting && selectionBounds ? (
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

                {exporting ? null : snapLines.map((line) => (
                  <div
                    key={`${line.orientation}-${line.value}`}
                    className={clsx('snap-line', line.orientation)}
                    style={line.orientation === 'vertical' ? { left: `${line.value * canvasScale}px` } : { top: `${line.value * canvasScale}px` }}
                  />
                ))}

                {!exporting && marqueeBounds ? (
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
            <p>先新建一个空白草稿、导入外部文件为草稿，或从模板库打开已有模板。</p>
          </div>
          <div className="empty-workspace-actions">
            <button className="action-button" onClick={onCreateFreshDocument}>
              <FilePlus2 size={16} />
              新建草稿
            </button>
            <button className="ghost-button" onClick={onImportDdl}>
              <Upload size={16} />
              导入为草稿
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

function InlineContentEditor({
  element,
  value,
  canvasScale,
  onChange,
  onCommit,
  onCancel,
}: {
  element: Extract<LabelElement, { type: 'text' | 'barcode' | 'qrcode' }>
  value: string
  canvasScale: number
  onChange: (value: string) => void
  onCommit: () => void
  onCancel: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) {
      return
    }

    textarea.focus()
    const caret = textarea.value.length
    textarea.setSelectionRange(caret, caret)
  }, [element.id])

  const editorPresentation = useMemo(() => getInlineEditorPresentation(element, value, canvasScale), [canvasScale, element, value])

  function handleKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
      return
    }

    if (event.key !== 'Enter') {
      return
    }

    if (element.type === 'text' && (event.altKey || event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      insertNewLineAtSelection(textareaRef.current, value, onChange)
      return
    }

    if (!(event.altKey || event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      onCommit()
      return
    }

    event.preventDefault()
    onCommit()
  }

  return (
    <div
      className="inline-content-editor"
      data-canvas-element-id={element.id}
      style={{
        left: `${editorPresentation.frame.x}px`,
        top: `${editorPresentation.frame.y}px`,
        width: `${editorPresentation.frame.width}px`,
        height: `${editorPresentation.frame.height}px`,
        transform: `rotate(${element.rotation}deg)`,
        zIndex: (element.zIndex ?? 0) + 2,
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <textarea
        ref={textareaRef}
        value={value}
        className="inline-content-editor-input"
        spellCheck={false}
        rows={element.type === 'text' ? 3 : 1}
        wrap="off"
        style={{
          fontSize: `${editorPresentation.fontSize}px`,
          lineHeight: `${editorPresentation.lineHeight}px`,
          fontFamily: editorPresentation.fontFamily,
          fontWeight: editorPresentation.fontWeight,
          fontStyle: editorPresentation.fontStyle,
          textAlign: editorPresentation.textAlign,
        }}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}

function getInlineEditorPresentation(element: Extract<LabelElement, { type: 'text' | 'barcode' | 'qrcode' }>, value: string, canvasScale: number) {
  const content = value || ' '
  const lines = element.type === 'text' ? content.split(/\r?\n/) : [content.replace(/\r?\n/g, ' ')]
  const fontFamily = getEditorFontFamily(element)
  const fontWeight = element.type === 'text' && element.bold ? 700 : 500
  const fontStyle = element.type === 'text' && element.italic ? 'italic' : 'normal'
  const lineHeightRatio = 1.18
  const frame = getInlineEditorFrame(element, canvasScale)
  const horizontalPadding = element.type === 'text' ? 8 : 4
  const verticalPadding = element.type === 'text' ? 8 : 4
  const availableWidth = Math.max(8, frame.width - horizontalPadding)
  const availableHeight = Math.max(8, frame.height - verticalPadding)
  const requestedFontSize = getRequestedEditorFontSize(element, canvasScale)
  const measuredWidth = measureLongestLineWidth(lines, fontFamily, fontWeight, fontStyle, requestedFontSize)
  const widthLimitedFontSize = measuredWidth > 0 ? requestedFontSize * Math.min(1, availableWidth / measuredWidth) : requestedFontSize
  const heightLimitedFontSize = availableHeight / Math.max(1, lines.length * lineHeightRatio)
  const fontSize = Math.max(8, Math.min(requestedFontSize, widthLimitedFontSize, heightLimitedFontSize))
  const textHeight = Math.max(18, Math.min(frame.height, lines.length * fontSize * lineHeightRatio + (element.type === 'text' ? 6 : 4)))
  const refinedFrame = element.type === 'text'
    ? {
        ...frame,
        y: frame.y + (frame.height - textHeight) / 2,
        height: textHeight,
      }
    : frame

  return {
    frame: refinedFrame,
    fontSize,
    lineHeight: fontSize * lineHeightRatio,
    fontFamily,
    fontWeight,
    fontStyle,
    textAlign: element.type === 'text' ? element.align : 'center' as const,
  }
}

function getInlineEditorFrame(element: TextElement | BarcodeElement | QrCodeElement, canvasScale: number) {
  if (element.type === 'text') {
    return {
      x: element.x * canvasScale,
      y: element.y * canvasScale,
      width: element.width * canvasScale,
      height: element.height * canvasScale,
    }
  }

  const width = Math.max(1, Math.round(element.width * canvasScale))
  const height = Math.max(1, Math.round(element.height * canvasScale))
  const layout = element.type === 'barcode'
    ? getBarcodeLayout(element, width, height, canvasScale)
    : getQrCodeLayout(element, width, height, canvasScale)
  const textBounds = layout.text

  if (textBounds) {
    return {
      x: element.x * canvasScale + textBounds.x,
      y: element.y * canvasScale + textBounds.y,
      width: textBounds.width,
      height: textBounds.height,
    }
  }

  const fallbackHeight = Math.max(28, Math.min(height * 0.28, 44))
  return {
    x: element.x * canvasScale,
    y: element.y * canvasScale + (height - fallbackHeight) / 2,
    width,
    height: fallbackHeight,
  }
}

function getRequestedEditorFontSize(element: TextElement | BarcodeElement | QrCodeElement, canvasScale: number) {
  return element.type === 'text'
    ? pointsToMm(element.fontSize) * canvasScale
    : pointsToMm(element.humanReadableFontSize) * canvasScale
}

function getEditorFontFamily(element: TextElement | BarcodeElement | QrCodeElement) {
  const family = element.type === 'text' ? element.fontFamily : element.humanReadableFontFamily
  return `"${normalizeFontFamily(family)}", "Microsoft YaHei", "微软雅黑", sans-serif`
}

function measureLongestLineWidth(lines: string[], fontFamily: string, fontWeight: number, fontStyle: string, fontSize: number) {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) {
    return 0
  }

  context.font = `${fontStyle} ${fontWeight} ${fontSize}px ${fontFamily}`
  return Math.max(...lines.map((line) => context.measureText(line || ' ').width), 0)
}

function insertNewLineAtSelection(
  textarea: HTMLTextAreaElement | null,
  value: string,
  onChange: (value: string) => void,
) {
  if (!textarea) {
    onChange(`${value}\n`)
    return
  }

  const start = textarea.selectionStart ?? value.length
  const end = textarea.selectionEnd ?? value.length
  const nextValue = `${value.slice(0, start)}\n${value.slice(end)}`
  onChange(nextValue)
  window.requestAnimationFrame(() => {
    textarea.focus()
    const caret = start + 1
    textarea.setSelectionRange(caret, caret)
  })
}
