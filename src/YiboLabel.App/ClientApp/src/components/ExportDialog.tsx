import { Download } from 'lucide-react'
import type { ExportFormat } from '../platform/exportBridge'

export type PdfPaperMode = 'label' | 'a4-portrait' | 'a4-landscape'

export type ExportDialogOptions = {
  format: ExportFormat
  pdfPaperMode: PdfPaperMode
}

type ExportDialogProps = {
  open: boolean
  exporting: boolean
  options: ExportDialogOptions
  onOptionsChange: (options: ExportDialogOptions) => void
  onClose: () => void
  onExport: () => void
}

const formatOptions: Array<{ value: ExportFormat; label: string; description: string }> = [
  { value: 'template', label: '本地模板', description: '*.yblabel.json' },
  { value: 'png', label: 'PNG 图片', description: '*.png' },
  { value: 'jpg', label: 'JPG 图片', description: '*.jpg' },
  { value: 'pdf', label: 'PDF 文档', description: '*.pdf' },
]

const pdfPaperOptions: Array<{ value: PdfPaperMode; label: string; description: string }> = [
  { value: 'label', label: '当前标签尺寸', description: '按标签实际宽高保存' },
  { value: 'a4-portrait', label: 'A4 纵向', description: '210 x 297 mm，标签居中' },
  { value: 'a4-landscape', label: 'A4 横向', description: '297 x 210 mm，标签居中' },
]

export function ExportDialog({
  open,
  exporting,
  options,
  onOptionsChange,
  onClose,
  onExport,
}: ExportDialogProps) {
  if (!open) {
    return null
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-panel-body">
          <div className="modal-heading">
            <div>
              <h2 id="export-dialog-title">导出标签</h2>
              <p>选择格式后会打开 Windows 原生保存对话框。</p>
            </div>
            <Download size={20} />
          </div>

          <div className="export-option-grid" aria-label="导出格式">
            {formatOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={options.format === option.value ? 'export-option active' : 'export-option'}
                onClick={() => onOptionsChange({ ...options, format: option.value })}
              >
                <strong>{option.label}</strong>
                <span>{option.description}</span>
              </button>
            ))}
          </div>

          {options.format === 'pdf' ? (
            <div className="export-paper-section">
              <div className="inspector-section-head">
                <strong>PDF 纸张</strong>
                <span>保存尺寸</span>
              </div>
              <div className="export-option-grid paper">
                {pdfPaperOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={options.pdfPaperMode === option.value ? 'export-option active' : 'export-option'}
                    onClick={() => onOptionsChange({ ...options, pdfPaperMode: option.value })}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="modal-actions">
          <button className="ghost-button compact-button" type="button" onClick={onClose} disabled={exporting}>
            取消
          </button>
          <button className="action-button compact-button" type="button" onClick={onExport} disabled={exporting}>
            <Download size={14} />
            {exporting ? '导出中...' : '导出'}
          </button>
        </div>
      </section>
    </div>
  )
}
