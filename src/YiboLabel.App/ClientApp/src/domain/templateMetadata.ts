import type { LabelTemplateRecord, LabelTemplateSummary } from '../types'

export function toTemplateSummary(record: LabelTemplateRecord): LabelTemplateSummary {
  return {
    id: record.id,
    name: record.name,
    sortOrder: record.sortOrder,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    widthMm: record.document.widthMm,
    heightMm: record.document.heightMm,
    elementCount: record.document.elements.length,
  }
}
