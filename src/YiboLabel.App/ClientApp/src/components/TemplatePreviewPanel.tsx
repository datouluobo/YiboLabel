import { useEffect, useState } from 'react'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { renderLabelDocumentToDataUrl } from '../domain/exportRenderer'
import { normalizeDocument } from '../domain/labelDocument'
import { formatDocumentSpecSummary } from '../domain/printWorkflow'
import type { LabelTemplateRecord } from '../types'

type TemplateOpenState = {
  openCount: number
  current: boolean
  dirty: boolean
}

type TemplatePreviewPanelProps = {
  previewTemplateId: string | null
  previewTemplate: LabelTemplateRecord | null
  loading: boolean
  openedState: TemplateOpenState | null
  onEditTemplate: (templateId: string) => void
}

export function TemplatePreviewPanel({
  previewTemplateId,
  previewTemplate,
  loading,
  openedState,
  onEditTemplate,
}: TemplatePreviewPanelProps) {
  const [previewImageUrl, setPreviewImageUrl] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function renderPreview() {
      if (!previewTemplate) {
        setPreviewImageUrl(null)
        setPreviewError(null)
        return
      }

      setPreviewError(null)
      try {
        const nextUrl = await renderLabelDocumentToDataUrl(normalizeDocument(previewTemplate.document), 'png')
        if (!cancelled) {
          setPreviewImageUrl(nextUrl)
        }
      } catch {
        if (!cancelled) {
          setPreviewImageUrl(null)
          setPreviewError('预览生成失败，可直接进入编辑查看。')
        }
      }
    }

    void renderPreview()
    return () => {
      cancelled = true
    }
  }, [previewTemplate])

  if (!previewTemplateId) {
    return (
      <section className="canvas-panel template-preview-panel">
        <div className="template-preview-empty">
          <strong>请选择一个模板</strong>
          <span>左侧单击模板可查看预览，双击可直接打开编辑。</span>
        </div>
      </section>
    )
  }

  if (loading || !previewTemplate) {
    return (
      <section className="canvas-panel template-preview-panel">
        <div className="template-preview-empty">
          <LoaderCircle size={18} className="is-spinning" />
          <span>正在加载模板预览...</span>
        </div>
      </section>
    )
  }

  const primaryActionLabel = openedState?.current
    ? '切到已打开模板'
    : openedState?.openCount
      ? '编辑模板'
      : '编辑模板'

  return (
    <section className="canvas-panel template-preview-panel">
      <div className="template-preview-head">
        <div className="template-preview-title">
          <strong>{previewTemplate.name}</strong>
          <span>{formatDocumentSpecSummary(previewTemplate.document)}</span>
        </div>
        <button className="action-button" type="button" onClick={() => onEditTemplate(previewTemplate.id)}>
          <ExternalLink size={16} />
          {primaryActionLabel}
        </button>
      </div>

      <div className="template-preview-layout">
        <div className="template-preview-canvas">
          {previewImageUrl ? (
            <img src={previewImageUrl} alt={`${previewTemplate.name} 预览`} />
          ) : (
            <div className="template-preview-fallback">{previewError ?? '暂无预览'}</div>
          )}
        </div>

        <dl className="template-preview-meta">
          <div>
            <dt>模板名称</dt>
            <dd>{previewTemplate.name}</dd>
          </div>
          <div>
            <dt>模板尺寸</dt>
            <dd>{previewTemplate.document.widthMm} x {previewTemplate.document.heightMm} mm</dd>
          </div>
          <div>
            <dt>元素数量</dt>
            <dd>{previewTemplate.document.elements.length}</dd>
          </div>
          <div>
            <dt>最近修改</dt>
            <dd>{new Date(previewTemplate.updatedAt).toLocaleString()}</dd>
          </div>
          <div>
            <dt>打印机</dt>
            <dd>{previewTemplate.document.printerDevicePath?.trim() || '未指定'}</dd>
          </div>
          <div>
            <dt>纸张来源</dt>
            <dd>{previewTemplate.document.sourceSpecName?.trim() || '未指定'}</dd>
          </div>
        </dl>
      </div>
    </section>
  )
}
