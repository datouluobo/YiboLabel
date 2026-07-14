import { FilePlus2, Upload } from 'lucide-react'
import clsx from 'clsx'
import { formatTemplateSource } from '../domain/templateMetadata'
import type { LabelTemplateSummary } from '../types'

type TemplateOpenState = {
  openCount: number
  current: boolean
  dirty: boolean
}

type TemplateLibraryViewProps = {
  templates: LabelTemplateSummary[]
  visibleTemplates: LabelTemplateSummary[]
  templateQuery: string
  templateSort: 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'created-desc' | 'created-asc'
  openedTemplateState: Map<string, TemplateOpenState>
  onTemplateQueryChange: (value: string) => void
  onTemplateSortChange: (value: 'updated-desc' | 'updated-asc' | 'name-asc' | 'name-desc' | 'created-desc' | 'created-asc') => void
  onCreateDocument: () => void
  onImportDdl: () => void
  onOpenTemplate: (templateId: string) => void
  onDuplicateTemplate: (template: LabelTemplateSummary) => void
  onRenameTemplate: (template: LabelTemplateSummary) => void
  onDeleteTemplate: (template: LabelTemplateSummary) => void
}

export function TemplateLibraryView({
  templates,
  visibleTemplates,
  templateQuery,
  templateSort,
  openedTemplateState,
  onTemplateQueryChange,
  onTemplateSortChange,
  onCreateDocument,
  onImportDdl,
  onOpenTemplate,
  onDuplicateTemplate,
  onRenameTemplate,
  onDeleteTemplate,
}: TemplateLibraryViewProps) {
  return (
    <section className="canvas-panel templates-workspace">
      <div className="panel-heading template-browser-head">
        <div>
          <span>模板库</span>
          <p className="panel-note">打开、搜索和管理本地模板，或新建空白标签开始编辑。</p>
        </div>
        <div className="command-bar">
          <button className="ghost-button compact-button" onClick={onCreateDocument}>
            <FilePlus2 size={14} />
            新建标签
          </button>
          <button className="ghost-button compact-button" onClick={onImportDdl}>
            <Upload size={14} />
            导入 DDL
          </button>
        </div>
      </div>
      <div className="field-row">
        <label>
          搜索模板
          <input value={templateQuery} onChange={(event) => onTemplateQueryChange(event.target.value)} placeholder="按名称、描述或标签搜索" />
        </label>
        <label>
          排序
          <select value={templateSort} onChange={(event) => onTemplateSortChange(event.target.value as TemplateLibraryViewProps['templateSort'])}>
            <option value="updated-desc">最近更新优先</option>
            <option value="updated-asc">最早更新优先</option>
            <option value="created-desc">最近创建优先</option>
            <option value="created-asc">最早创建优先</option>
            <option value="name-asc">名称 A-Z</option>
            <option value="name-desc">名称 Z-A</option>
          </select>
        </label>
      </div>
      <div className="template-browser-grid">
        {visibleTemplates.length === 0 ? (
          <div className="empty-workspace">
            <div className="empty-workspace-copy">
              <h2>{templates.length === 0 ? '还没有本地模板' : '没有匹配的模板'}</h2>
              <p>{templates.length === 0 ? '先新建一个标签并保存，或导入一份 DDL 模板。' : '试试调整搜索词或排序方式。'}</p>
            </div>
            <div className="empty-workspace-actions">
              <button className="action-button" onClick={onCreateDocument}>
                <FilePlus2 size={16} />
                新建标签
              </button>
              <button className="ghost-button" onClick={onImportDdl}>
                <Upload size={16} />
                导入 DDL
              </button>
            </div>
          </div>
        ) : (
          visibleTemplates.map((template) => {
            const openedState = openedTemplateState.get(template.id)
            return (
              <div
                key={template.id}
                className={clsx('template-card template-card-large', openedState?.current && 'active')}
                role="button"
                tabIndex={0}
                onClick={() => onOpenTemplate(template.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onOpenTemplate(template.id)
                  }
                }}
              >
                <div className="template-card-head">
                  <strong>{template.name}</strong>
                  <div className="template-flags">
                    {openedState?.current ? <span className="template-flag current">当前</span> : null}
                    {openedState?.openCount ? <span className="template-flag open">已打开 {openedState.openCount}</span> : null}
                    {openedState?.dirty ? <span className="template-flag dirty">有修改</span> : null}
                  </div>
                </div>
                <span>{template.description || `来源：${formatTemplateSource(template.source)}`}</span>
                <span>
                  {template.widthMm} × {template.heightMm} mm · {template.elementCount} 个元素
                </span>
                {template.tags.length > 0 ? <small>标签：{template.tags.join('、')}</small> : null}
                <small>更新于 {new Date(template.updatedAt).toLocaleString()}</small>
                <div className="command-bar">
                  <button
                    className="mini-button"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDuplicateTemplate(template)
                    }}
                  >
                    复制
                  </button>
                  <button
                    className="mini-button"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onRenameTemplate(template)
                    }}
                  >
                    重命名
                  </button>
                  <button
                    className="mini-button"
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDeleteTemplate(template)
                    }}
                  >
                    删除
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </section>
  )
}
