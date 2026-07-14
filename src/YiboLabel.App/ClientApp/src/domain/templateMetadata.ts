import type { EditorTab } from './workspace'
import type { LabelTemplateRecord, LabelTemplateSummary } from '../types'

export function toTemplateSummary(record: LabelTemplateRecord): LabelTemplateSummary {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    tags: record.tags,
    source: record.source,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt,
    widthMm: record.document.widthMm,
    heightMm: record.document.heightMm,
    elementCount: record.document.elements.length,
  }
}

export function parseTagInput(value: string) {
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export function formatTemplateSource(source: string) {
  if (source === 'ddl-import') {
    return 'DDL 导入'
  }
  if (source === 'duplicate') {
    return '模板复制'
  }
  if (source === 'seed') {
    return '系统示例'
  }
  if (source === 'blank') {
    return '空白草稿'
  }
  return '手工创建'
}

export function applyTemplateMetaPatch(
  tab: EditorTab,
  patch: Partial<Pick<EditorTab, 'templateDescription' | 'templateTags' | 'templateSource'>>,
) {
  return {
    ...tab,
    templateDescription: patch.templateDescription ?? tab.templateDescription,
    templateTags: patch.templateTags ?? tab.templateTags,
    templateSource: patch.templateSource ?? tab.templateSource,
  }
}
