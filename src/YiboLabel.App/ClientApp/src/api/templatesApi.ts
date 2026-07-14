import type {
  DuplicateTemplateRequest,
  LabelTemplateRecord,
  LabelTemplateSummary,
  SaveTemplateRequest,
  UpdateTemplateMetaRequest,
} from '../types'
import { deleteJson, fetchJson, patchJson, postJson, putJson } from './http'

export function fetchTemplates() {
  return fetchJson<LabelTemplateSummary[]>('/api/templates')
}

export function fetchTemplate(id: string) {
  return fetchJson<LabelTemplateRecord>(`/api/templates/${id}`)
}

export function createTemplate(request: SaveTemplateRequest) {
  return postJson<LabelTemplateRecord>('/api/templates', request)
}

export function updateTemplate(id: string, request: SaveTemplateRequest) {
  return putJson<LabelTemplateRecord>(`/api/templates/${id}`, request)
}

export function updateTemplateMeta(id: string, request: UpdateTemplateMetaRequest) {
  return patchJson<LabelTemplateRecord, UpdateTemplateMetaRequest>(`/api/templates/${id}/meta`, request)
}

export function duplicateTemplate(id: string, request: DuplicateTemplateRequest) {
  return postJson<LabelTemplateRecord>(`/api/templates/${id}/duplicate`, request)
}

export function deleteTemplate(id: string) {
  return deleteJson(`/api/templates/${id}`)
}
