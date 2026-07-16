import { Printer, RefreshCw, Save } from 'lucide-react'
import clsx from 'clsx'
import type { ElementOverlapSummary } from '../domain/editorGeometry'
import type { AppStateResponse, LabelDocument } from '../types'

type DocumentPrintDialogProps = {
  open: boolean
  labelDocument: LabelDocument
  appState: AppStateResponse | null
  currentPrinter: AppStateResponse['printers'][number] | null
  overlapSummary: ElementOverlapSummary
  refreshingPrinters: boolean
  saving: boolean
  printing: boolean
  onClose: () => void
  onDocumentFieldChange: <K extends keyof LabelDocument>(key: K, value: LabelDocument[K]) => void
  onRefreshPrinters: () => void
  onSaveCurrentTemplate: () => void
  onSaveAsTemplate: () => void
  onPrintCurrent: () => void
}

export function DocumentPrintDialog({
  open,
  labelDocument,
  appState,
  currentPrinter,
  overlapSummary,
  refreshingPrinters,
  saving,
  printing,
  onClose,
  onDocumentFieldChange,
  onRefreshPrinters,
  onSaveCurrentTemplate,
  onSaveAsTemplate,
  onPrintCurrent,
}: DocumentPrintDialogProps) {
  if (!open) {
    return null
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section className="modal-panel" onClick={(event) => event.stopPropagation()}>
        <div className="panel-heading">
          <span>文档与打印</span>
          <button className="inline-icon-button" onClick={onClose} aria-label="关闭文档与打印">
            ×
          </button>
        </div>
        <div className="modal-panel-body">
          <label>
            模板名称
            <input value={labelDocument.name} onChange={(event) => onDocumentFieldChange('name', event.target.value)} />
          </label>
          <div className="field-row">
            <label>
              宽度 (mm)
              <input type="number" min="20" step="1" value={labelDocument.widthMm} onChange={(event) => onDocumentFieldChange('widthMm', Number(event.target.value))} />
            </label>
            <label>
              高度 (mm)
              <input type="number" min="20" step="1" value={labelDocument.heightMm} onChange={(event) => onDocumentFieldChange('heightMm', Number(event.target.value))} />
            </label>
          </div>
          <div className="field-row">
            <label>
              间隙 (mm)
              <input type="number" min="0" step="0.5" value={labelDocument.gapMm} onChange={(event) => onDocumentFieldChange('gapMm', Number(event.target.value))} />
            </label>
            <label>
              打印浓度
              <input type="number" min="1" max="15" step="1" value={labelDocument.darkness} onChange={(event) => onDocumentFieldChange('darkness', Number(event.target.value))} />
            </label>
          </div>
          <div className="field-row">
            <label>
              打印方向
              <select value={labelDocument.printRotation} onChange={(event) => onDocumentFieldChange('printRotation', Number(event.target.value))}>
                <option value="0">正常</option>
                <option value="90">顺时针 90°</option>
                <option value="180">旋转 180°</option>
                <option value="270">逆时针 90°</option>
              </select>
            </label>
            <label className="toggle-row">
              黑白反相
              <input type="checkbox" checked={labelDocument.printInvert} onChange={(event) => onDocumentFieldChange('printInvert', event.target.checked)} />
            </label>
          </div>
          <div className="field-row">
            <label>
              横向微调 (mm)
              <input
                type="number"
                min="-20"
                max="20"
                step="0.1"
                value={labelDocument.printOffsetXMm}
                onChange={(event) => onDocumentFieldChange('printOffsetXMm', Number(event.target.value))}
              />
            </label>
            <label>
              纵向微调 (mm)
              <input
                type="number"
                min="-20"
                max="20"
                step="0.1"
                value={labelDocument.printOffsetYMm}
                onChange={(event) => onDocumentFieldChange('printOffsetYMm', Number(event.target.value))}
              />
            </label>
          </div>
          <label>
            打印份数
            <input type="number" min="1" max="99" value={labelDocument.copies} onChange={(event) => onDocumentFieldChange('copies', Number(event.target.value))} />
          </label>
          <label>
            打印机
            <select
              value={labelDocument.printerDevicePath ?? appState?.printers[0]?.devicePath ?? ''}
              onChange={(event) => onDocumentFieldChange('printerDevicePath', event.target.value)}
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
              <button className="inline-icon-button" type="button" onClick={onRefreshPrinters} disabled={refreshingPrinters} title="刷新打印机状态" aria-label="刷新打印机状态">
                <RefreshCw size={14} className={refreshingPrinters ? 'is-spinning' : undefined} />
              </button>
            </div>
          ) : null}
          {overlapSummary.overlapCount > 0 ? (
            <div className="print-warning">
              <strong>发现 {overlapSummary.overlapCount} 组元素重叠</strong>
              <span>打印机可能会把重叠区域重复打印，导致变粗、变黑或影响扫码。请先测试确认效果。</span>
              {overlapSummary.barcodeOrQrOverlapCount > 0 ? <span>其中有 {overlapSummary.barcodeOrQrOverlapCount} 组涉及条码或二维码，可能影响扫码识别。</span> : null}
            </div>
          ) : null}
        </div>
        <div className="modal-actions">
          <button className="ghost-button compact-button" onClick={onSaveCurrentTemplate} disabled={saving}>
            <Save size={14} />
            {saving ? '保存中...' : '保存'}
          </button>
          <button className="ghost-button compact-button" onClick={onSaveAsTemplate} disabled={saving}>
            <Save size={14} />
            另存为模板
          </button>
          <button className="print-button compact-button" onClick={onPrintCurrent} disabled={printing || !currentPrinter?.isAvailable}>
            <Printer size={14} />
            {printing ? '打印中...' : '立即打印'}
          </button>
        </div>
      </section>
    </div>
  )
}
