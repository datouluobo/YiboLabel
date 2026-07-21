import { BookOpen, Code2, Database, ExternalLink, Files, X } from 'lucide-react'

type AboutDialogProps = {
  open: boolean
  appVersion: string | null
  githubUrl: string
  onClose: () => void
}

const productHighlights = [
  {
    icon: Files,
    title: '模板复用',
    detail: '保存常用标签版式，按模板快速新建、复制、调整和再次打印。',
  },
  {
    icon: BookOpen,
    title: '词库填充',
    detail: '把常用内容维护成词库分组，拖放或绑定到文本、条码、二维码元素。',
  },
  {
    icon: Database,
    title: '本地数据',
    detail: '模板、词库、校准和备份都保存在本机，方便理解、迁移和恢复。',
  },
]

export function AboutDialog({ open, appVersion, githubUrl, onClose }: AboutDialogProps) {
  if (!open) {
    return null
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal-panel about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-panel-body">
          <div className="modal-heading about-dialog-heading">
            <div className="about-dialog-title">
              <img className="about-dialog-mark" src="/favicon.svg" alt="" aria-hidden="true" />
              <div>
                <h2 id="about-dialog-title">YiboLabel</h2>
                <p>Windows 本地标签打印工具</p>
              </div>
            </div>
            <button className="inline-icon-button about-dialog-close" type="button" onClick={onClose} aria-label="关闭关于窗口" title="关闭">
              <X size={16} />
            </button>
          </div>

          <div className="about-dialog-meta">
            <span>{appVersion ? `v${appVersion}` : '本地版本'}</span>
            <span>作者：YiboSoft</span>
          </div>

          <p className="about-dialog-summary">
            面向固定尺寸标签的本地编辑、模板管理和词库填充工具；适合把常用版式保存成模板，再用词库快速替换名称、编号、条码或二维码内容。
          </p>

          <div className="about-highlight-list" aria-label="产品特点">
            {productHighlights.map(({ icon: Icon, title, detail }) => (
              <div className="about-highlight" key={title}>
                <span className="about-highlight-icon" aria-hidden="true">
                  <Icon size={15} />
                </span>
                <div>
                  <strong>{title}</strong>
                  <p>{detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-actions about-dialog-actions">
          <a className="print-button about-github-link" href={githubUrl} target="_blank" rel="noreferrer">
            <Code2 size={16} />
            GitHub
            <ExternalLink size={14} />
          </a>
          <button className="ghost-button compact-button" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  )
}
