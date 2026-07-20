import type {
  DuplicateTemplateRequest,
  LabelTemplateRecord,
  LabelTemplateSummary,
  MoveTemplateRequest,
  RenameTemplateRequest,
  SaveTemplateRequest,
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

export function renameTemplate(id: string, request: RenameTemplateRequest) {
  return patchJson<LabelTemplateRecord, RenameTemplateRequest>(`/api/templates/${id}/name`, request)
}

export function duplicateTemplate(id: string, request: DuplicateTemplateRequest) {
  return postJson<LabelTemplateRecord>(`/api/templates/${id}/duplicate`, request)
}

export function moveTemplate(id: string, request: MoveTemplateRequest) {
  return postJson<LabelTemplateSummary[]>(`/api/templates/${id}/move`, request)
}

export function deleteTemplate(id: string) {
  return deleteJson(`/api/templates/${id}`)
}
